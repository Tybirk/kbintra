"""
Views for Food app.
"""

import contextlib
import logging
from datetime import date, timedelta
from typing import Any

from django.db import transaction
from django.db.models import Count, Q, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .constants import DAY_NAMES
from .models import (
    BroadcastStatus,
    ClosedFoodDay,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealPrice,
    MealRegistration,
    SwapBroadcast,
    SwapRequestStatus,
    TeamFavour,
    TeamSwapRequest,
)
from .pricing import get_price_schedule, get_prices
from .serializers import (
    AcceptSwapBroadcastSerializer,
    ClosedFoodDayCreateSerializer,
    ClosedFoodDaySerializer,
    CreateSwapBroadcastSerializer,
    CreateSwapRequestSerializer,
    DefaultCookingDaysSerializer,
    DriveMenuCacheSerializer,
    FoodRosterSerializer,
    FoodTeamCycleCreateSerializer,
    FoodTeamCycleSerializer,
    FoodTeamListSerializer,
    FoodTeamMemberSerializer,
    FoodTeamSerializer,
    FoodTeamWishCreateUpdateSerializer,
    FoodTeamWishSerializer,
    FoodTicketCreateSerializer,
    FoodTicketSerializer,
    GenerateTeamsSerializer,
    MealPreferenceCreateUpdateSerializer,
    MealPreferenceSerializer,
    MealPriceSerializer,
    MealRegistrationCreateUpdateSerializer,
    MealRegistrationSerializer,
    MonthlyFoodCostReportSerializer,
    MyFoodProfileSerializer,
    RespondSwapRequestSerializer,
    SwapBroadcastSerializer,
    TakeoverSerializer,
    TeamFavourSerializer,
    TeamGenerationResultSerializer,
    TeamSwapRequestSerializer,
    is_after_deadline,
)
from .services.team_generator import TeamGenerator

logger = logging.getLogger(__name__)


class IsFoodAdmin(permissions.BasePermission):
    """Allow access to staff or users with is_food_admin set."""

    def has_permission(self, request: Request, view) -> bool:  # type: ignore[no-untyped-def]
        u = request.user
        return bool(u and u.is_authenticated and (u.is_staff or getattr(u, "is_food_admin", False)))


class IsFoodOrEconomyAdmin(permissions.BasePermission):
    """Allow food admins or economy admins (the treasurer reads the cost report)."""

    def has_permission(self, request: Request, view) -> bool:  # type: ignore[no-untyped-def]
        u = request.user
        return bool(
            u
            and u.is_authenticated
            and (getattr(u, "has_food_admin", False) or getattr(u, "has_economy_admin", False))
        )


def get_week_start(d: date) -> date:
    """Get the Monday of the week containing the given date."""
    return d - timedelta(days=d.weekday())


def _get_preference_values(
    pref: MealPreference | None, house_count: int
) -> tuple[int, int, int, str, str]:
    """Extract portion values from a preference, or return system defaults."""
    if pref:
        return (
            pref.adults_meat,
            pref.adults_veg,
            pref.children_count,
            pref.dining_option,
            pref.seating_time,
        )
    return 0, house_count, 0, "eat_in", "17:30"


def _build_virtual_registration(
    target_date: date,
    day_of_week: int,
    pref: MealPreference | None,
    house: Any,
    house_count: int,
) -> dict[str, Any]:
    """Return a dict matching MealRegistrationSerializer output for a day with no real row."""
    meat, veg, children, dining, seating = _get_preference_values(pref, house_count)
    is_eating = meat + veg + children > 0
    return {
        "id": None,
        "date": target_date.isoformat(),
        "day_of_week": day_of_week,
        "day_name": DAY_NAMES[day_of_week],
        "adults_meat": meat,
        "adults_veg": veg,
        "children_count": children,
        "dining_option": dining,
        "seating_time": seating,
        "house": {"id": house.id, "name": house.name} if house else None,
        "is_active": is_eating,
        "total_portions": meat + veg + children,
        "is_locked": is_after_deadline(target_date),
        "is_from_preference": True,
        "available_portions": {"adults_meat": 0, "adults_veg": 0, "children_count": 0},
        "created_at": None,
        "updated_at": None,
    }


def _materialize_registration(
    user: Any,
    target_date: date,
    pref: MealPreference | None,
    house: Any,
    house_count: int,
) -> MealRegistration:
    """Create a real MealRegistration from preference/defaults. Used post-deadline.

    Uses get_or_create to handle concurrent requests safely.
    """
    meat, veg, children, dining, seating = _get_preference_values(pref, house_count)
    reg, _ = MealRegistration.objects.get_or_create(
        house=house,
        date=target_date,
        defaults={
            "last_modified_by": user,
            "adults_meat": meat,
            "adults_veg": veg,
            "children_count": children,
            "dining_option": dining,
            "seating_time": seating,
            "is_active": meat + veg + children > 0,
        },
    )
    return reg


class DailyRegistrationStatsView(APIView):
    """Get registration statistics for a specific date or week."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        # Get date or week_start from query params
        date_str = request.query_params.get("date")
        week_start_str = request.query_params.get("week_start")

        if date_str:
            # Get stats for a single date
            try:
                target_date = date.fromisoformat(date_str)
            except ValueError:
                return Response(
                    {"detail": "Invalid date format. Use YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            closed_obj = ClosedFoodDay.objects.filter(date=target_date).first()
            if closed_obj:
                return Response({"closed": True, "reason": closed_obj.reason})
            stats = self._get_stats_for_date(target_date)
            return Response(stats)

        elif week_start_str:
            # Get stats for a whole week (Mon-Thu)
            try:
                week_start = date.fromisoformat(week_start_str)
            except ValueError:
                return Response(
                    {"detail": "Invalid date format. Use YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            dates = [week_start + timedelta(days=d) for d in range(4)]
            closed_days = {c.date: c.reason for c in ClosedFoodDay.objects.filter(date__in=dates)}
            open_dates = [d for d in dates if d not in closed_days]
            result = self._get_stats_for_dates(open_dates) if open_dates else {}
            # Add closed-day markers
            for d, reason in closed_days.items():
                result[d.isoformat()] = {
                    "closed": True,
                    "reason": reason,
                }
            return Response(result)

        else:
            return Response(
                {"detail": "Please provide 'date' or 'week_start' query parameter."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _get_stats_for_date(self, target_date: date) -> dict[str, Any]:
        """Get registration statistics for a single date."""
        result = self._get_stats_for_dates([target_date])
        return result[target_date.isoformat()]

    def _get_stats_for_dates(self, dates: list[date]) -> dict[str, dict[str, Any]]:
        """Get registration statistics for multiple dates in batched queries.

        Totals are gross registrations — tickets do not reduce them. Available
        (unsold) tickets are ignored entirely; claimed tickets only move a
        portion between dining/seating buckets (the buyer controls where they
        eat), never changing the per-date total.

        With unique_together = ["house", "date"], each house has exactly one
        registration per date — no deduplication needed.
        """
        from apps.houses.models import House

        # 1. Materialization safety net for post-deadline dates (batched)
        post_deadline_dates = [d for d in dates if is_after_deadline(d)]
        if post_deadline_dates:
            from .tasks import _materialize_for_houses

            house_count = House.objects.filter(inhabitants__is_active=True).distinct().count()
            covered_counts = dict(
                MealRegistration.objects.filter(date__in=post_deadline_dates)
                .values("date")
                .annotate(cnt=Count("house_id", distinct=True))
                .values_list("date", "cnt")
            )
            unmaterialized = [
                d for d in post_deadline_dates if covered_counts.get(d, 0) < house_count
            ]
            if unmaterialized:
                _materialize_for_houses(unmaterialized)

        # 2. All registrations — one per house per date, no dedup needed
        all_registrations = MealRegistration.objects.filter(date__in=dates, is_active=True)

        # 3. Single conditional aggregate grouped by date (replaces 4 queries × N dates)
        _ta = Q(dining_option="take_away")
        _e17 = Q(dining_option="eat_in", seating_time="17:30")
        _e18 = Q(dining_option="eat_in", seating_time="18:30")
        agg_rows = all_registrations.values("date").annotate(
            ta_meat=Coalesce(Sum("adults_meat", filter=_ta), 0),
            ta_veg=Coalesce(Sum("adults_veg", filter=_ta), 0),
            ta_children=Coalesce(Sum("children_count", filter=_ta), 0),
            e17_meat=Coalesce(Sum("adults_meat", filter=_e17), 0),
            e17_veg=Coalesce(Sum("adults_veg", filter=_e17), 0),
            e17_children=Coalesce(Sum("children_count", filter=_e17), 0),
            e18_meat=Coalesce(Sum("adults_meat", filter=_e18), 0),
            e18_veg=Coalesce(Sum("adults_veg", filter=_e18), 0),
            e18_children=Coalesce(Sum("children_count", filter=_e18), 0),
            total_meat=Coalesce(Sum("adults_meat"), 0),
            total_veg=Coalesce(Sum("adults_veg"), 0),
            total_children=Coalesce(Sum("children_count"), 0),
        )
        agg_by_date: dict[date, dict[str, int]] = {row["date"]: row for row in agg_rows}
        empty_agg: dict[str, int] = {
            "ta_meat": 0,
            "ta_veg": 0,
            "ta_children": 0,
            "e17_meat": 0,
            "e17_veg": 0,
            "e17_children": 0,
            "e18_meat": 0,
            "e18_veg": 0,
            "e18_children": 0,
            "total_meat": 0,
            "total_veg": 0,
            "total_children": 0,
        }

        # 4. Virtual contributions for pre-deadline dates (batched)
        pre_deadline_dates = [d for d in dates if not is_after_deadline(d)]
        virtual_by_date: dict[date, dict[str, dict[str, int]]] = {}
        if pre_deadline_dates:
            # Covered house IDs for all pre-deadline dates (1 query)
            covered_by_date: dict[date, set[int]] = {}
            for d, hid in MealRegistration.objects.filter(
                date__in=pre_deadline_dates,
            ).values_list("date", "house_id"):
                covered_by_date.setdefault(d, set()).add(hid)

            # Preferences for all relevant weekdays (1 query)
            weekdays = {d.weekday() for d in pre_deadline_dates}
            prefs_by_weekday_house: dict[tuple[int, int], MealPreference] = {}
            for pref in MealPreference.objects.filter(day_of_week__in=weekdays).select_related(
                "house"
            ):
                key = (pref.day_of_week, pref.house_id)
                if key not in prefs_by_weekday_house:
                    prefs_by_weekday_house[key] = pref

            # Load houses once (1 query + 1 prefetch)
            houses = list(House.objects.prefetch_related("inhabitants"))

            for d in pre_deadline_dates:
                covered_ids = covered_by_date.get(d, set())
                virt: dict[str, dict[str, int]] = {
                    "take_away": {"adults_meat": 0, "adults_veg": 0, "children": 0},
                    "eat_in_1730": {"adults_meat": 0, "adults_veg": 0, "children": 0},
                    "eat_in_1830": {"adults_meat": 0, "adults_veg": 0, "children": 0},
                    "total": {"adults_meat": 0, "adults_veg": 0, "children": 0},
                }
                dow = d.weekday()
                for h in houses:
                    if h.id in covered_ids:
                        continue
                    pref = prefs_by_weekday_house.get((dow, h.id))
                    if pref:
                        meat, veg, children = (
                            pref.adults_meat,
                            pref.adults_veg,
                            pref.children_count,
                        )
                        if pref.dining_option == "take_away":
                            bucket = "take_away"
                        elif pref.seating_time == "17:30":
                            bucket = "eat_in_1730"
                        else:
                            bucket = "eat_in_1830"
                    else:
                        inhabitant_count = len(h.inhabitants.all())
                        if inhabitant_count == 0:
                            continue
                        meat, veg, children = 0, inhabitant_count, 0
                        bucket = "eat_in_1730"
                    for b in (bucket, "total"):
                        virt[b]["adults_meat"] += meat
                        virt[b]["adults_veg"] += veg
                        virt[b]["children"] += children
                virtual_by_date[d] = virt

        empty_virt: dict[str, dict[str, int]] = {
            "take_away": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "eat_in_1730": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "eat_in_1830": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "total": {"adults_meat": 0, "adults_veg": 0, "children": 0},
        }

        # 5. Claimed ticket bucket adjustments (up to 2 queries)
        # Portions from claimed tickets are counted via the seller's registration,
        # but the buyer controls where/when they eat. Move claimed portions from
        # the seller's dining/seating bucket to the buyer's.
        claimed_raw = list(
            FoodTicket.objects.filter(
                date__in=dates,
                is_available=False,
                claimed_by__isnull=False,
            ).values_list(
                "date",
                "owner_id",
                "claimed_by_id",
                "adults_meat",
                "adults_veg",
                "children_count",
            )
        )

        claimed_adj: dict[date, dict[str, dict[str, int]]] = {}
        if claimed_raw:
            # Collect house IDs for sellers and buyers to look up their dining options
            _uids: set[int] = set()
            for _, oid, cid, _, _, _ in claimed_raw:
                _uids.add(oid)
                _uids.add(cid)

            # Map user → house_id for all involved users
            from apps.users.models import User

            _user_house: dict[int, int | None] = dict(
                User.objects.filter(id__in=_uids).values_list("id", "house_id")
            )

            # Map (house_id, date) → (dining_option, seating_time)
            _house_ids = {hid for hid in _user_house.values() if hid}
            _dining: dict[tuple[int, date], tuple[str, str]] = {}
            for hid, d_val, dopt, stime in MealRegistration.objects.filter(
                house_id__in=_house_ids,
                date__in=dates,
            ).values_list("house_id", "date", "dining_option", "seating_time"):
                _dining[(hid, d_val)] = (dopt, stime)

            def _bkt(dining_opt: str, seat_time: str) -> str:
                if dining_opt == "take_away":
                    return "ta"
                return "e17" if seat_time == "17:30" else "e18"

            for d_val, oid, cid, c_meat, c_veg, c_ch in claimed_raw:
                seller_house = _user_house.get(oid)
                buyer_house = _user_house.get(cid)
                if not seller_house or not buyer_house:
                    continue
                sb = _bkt(*_dining.get((seller_house, d_val), ("eat_in", "17:30")))
                bb = _bkt(*_dining.get((buyer_house, d_val), ("eat_in", "17:30")))
                if sb == bb:
                    continue
                adj = claimed_adj.setdefault(d_val, {})
                for bk, sign in ((sb, -1), (bb, 1)):
                    ba = adj.setdefault(bk, {"meat": 0, "veg": 0, "children": 0})
                    ba["meat"] += sign * c_meat
                    ba["veg"] += sign * c_veg
                    ba["children"] += sign * c_ch

        # 6. Assemble results
        def _merge(
            db_meat: int, db_veg: int, db_children: int, virt_bucket: dict[str, int]
        ) -> dict[str, int]:
            m = db_meat + virt_bucket["adults_meat"]
            v = db_veg + virt_bucket["adults_veg"]
            c = db_children + virt_bucket["children"]
            return {"adults": m + v, "adults_meat": m, "adults_veg": v, "children": c}

        result: dict[str, dict[str, Any]] = {}
        for d in dates:
            agg = agg_by_date.get(d, empty_agg)

            # Apply claimed ticket bucket adjustments
            if d in claimed_adj:
                agg = dict(agg)  # copy to avoid mutating aggregate cache
                for bk, delta in claimed_adj[d].items():
                    agg[f"{bk}_meat"] = max(0, agg[f"{bk}_meat"] + delta["meat"])
                    agg[f"{bk}_veg"] = max(0, agg[f"{bk}_veg"] + delta["veg"])
                    agg[f"{bk}_children"] = max(0, agg[f"{bk}_children"] + delta["children"])
            virt = virtual_by_date.get(d, empty_virt)

            combined_meat = agg["total_meat"] + virt["total"]["adults_meat"]
            combined_veg = agg["total_veg"] + virt["total"]["adults_veg"]
            combined_children = agg["total_children"] + virt["total"]["children"]

            result[d.isoformat()] = {
                "date": d.isoformat(),
                "takeaway": _merge(
                    agg["ta_meat"], agg["ta_veg"], agg["ta_children"], virt["take_away"]
                ),
                "eat_in_1730": _merge(
                    agg["e17_meat"], agg["e17_veg"], agg["e17_children"], virt["eat_in_1730"]
                ),
                "eat_in_1830": _merge(
                    agg["e18_meat"], agg["e18_veg"], agg["e18_children"], virt["eat_in_1830"]
                ),
                # Gross registration totals. Tickets are intentionally NOT
                # deducted: an unsold (available) ticket does not reduce the
                # number of portions registered, and the seller is still billed
                # for their registration regardless of whether it sells. Ticket
                # trading is peer-to-peer and never changes community aggregates.
                "total_registrations": {
                    "adults": combined_meat + combined_veg,
                    "adults_meat": combined_meat,
                    "adults_veg": combined_veg,
                    "children": combined_children,
                },
            }

        return result


# Meal Preference Views
class MealPreferenceListCreateView(generics.ListCreateAPIView):
    """List or create meal preferences for the current user's house."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return MealPreferenceCreateUpdateSerializer
        return MealPreferenceSerializer

    def get_queryset(self) -> QuerySet[MealPreference]:
        house = self.request.user.house
        if not house:
            return MealPreference.objects.none()
        return MealPreference.objects.filter(house=house)


class MealPreferenceDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Get, update, or delete a meal preference."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return MealPreferenceCreateUpdateSerializer
        return MealPreferenceSerializer

    def get_queryset(self) -> QuerySet[MealPreference]:
        house = self.request.user.house
        if not house:
            return MealPreference.objects.none()
        return MealPreference.objects.filter(house=house)


# Meal Registration Views
class MealRegistrationListCreateView(generics.ListCreateAPIView):
    """List or create meal registrations for the current user.

    When `week_start` query param is present, always returns exactly 4 entries (Mon-Thu):
    - Days with a real DB row: serialized normally (is_from_preference=False)
    - Pre-deadline days with no real row: virtual registration from preference/default
    - Post-deadline days with no real row: lazily materialized into a real DB row
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return MealRegistrationCreateUpdateSerializer
        return MealRegistrationSerializer

    def get_queryset(self) -> QuerySet[MealRegistration]:
        house = self.request.user.house
        if not house:
            return MealRegistration.objects.none()
        queryset = MealRegistration.objects.filter(house=house).select_related("house")
        week_start = self.request.query_params.get("week_start")
        if week_start:
            try:
                start_date = date.fromisoformat(week_start)
            except ValueError:
                return queryset.none()
            end_date = start_date + timedelta(days=6)
            queryset = queryset.filter(date__gte=start_date, date__lte=end_date)
        return queryset

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        week_start_str = request.query_params.get("week_start")
        if not week_start_str:
            return super().list(request, *args, **kwargs)

        try:
            week_start = date.fromisoformat(week_start_str)
        except ValueError:
            return Response({"detail": "Invalid date."}, status=status.HTTP_400_BAD_REQUEST)

        real_regs = {r.date: r for r in self.get_queryset()}
        user = request.user
        house = user.house
        house_count = house.inhabitants.count() if house else 1
        prefs = (
            {p.day_of_week: p for p in MealPreference.objects.filter(house=house)} if house else {}
        )

        from .utils import get_closed_food_dates

        week_dates = [week_start + timedelta(days=d) for d in range(4)]
        closed = get_closed_food_dates(week_dates)
        closed_reasons = {}
        if closed:
            closed_reasons = {
                c.date: c.reason for c in ClosedFoodDay.objects.filter(date__in=closed)
            }

        results = []
        for day in range(4):
            target_date = week_start + timedelta(days=day)
            if target_date in closed:
                results.append(
                    {
                        "id": None,
                        "date": target_date.isoformat(),
                        "day_of_week": day,
                        "day_name": DAY_NAMES[day],
                        "is_closed": True,
                        "closed_reason": closed_reasons.get(target_date, ""),
                    }
                )
                continue
            if target_date in real_regs:
                results.append(
                    MealRegistrationSerializer(
                        real_regs[target_date], context={"request": request}
                    ).data
                )
            elif is_after_deadline(target_date) and house:
                reg = _materialize_registration(
                    user, target_date, prefs.get(day), house, house_count
                )
                results.append(MealRegistrationSerializer(reg, context={"request": request}).data)
            else:
                results.append(
                    _build_virtual_registration(
                        target_date, day, prefs.get(day), house, house_count
                    )
                )
        return Response(results)


class MealRegistrationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Get, update, or delete a meal registration."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return MealRegistrationCreateUpdateSerializer
        return MealRegistrationSerializer

    def get_queryset(self) -> QuerySet[MealRegistration]:
        house = self.request.user.house
        if not house:
            return MealRegistration.objects.none()
        return MealRegistration.objects.filter(house=house).select_related("house")


# Food Ticket Views
class FoodTicketListCreateView(generics.ListCreateAPIView):
    """List available food tickets or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FoodTicketCreateSerializer
        return FoodTicketSerializer

    def get_queryset(self) -> QuerySet[FoodTicket]:
        queryset = FoodTicket.objects.select_related("owner", "claimed_by")

        # By default only show available tickets for future dates
        show_all = self.request.query_params.get("all") == "true"
        if not show_all:
            queryset = queryset.filter(
                is_available=True,
                date__gte=timezone.now().date(),
            )

        return queryset


class FoodTicketDetailView(generics.RetrieveDestroyAPIView):
    """Get or delete a food ticket."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTicketSerializer
    queryset = FoodTicket.objects.select_related("owner", "claimed_by")

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        ticket = self.get_object()
        if ticket.house_id != request.user.house_id:
            return Response(
                {"detail": "You can only delete your own house's tickets."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not ticket.is_available:
            return Response(
                {"detail": "Cannot delete a claimed ticket."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ticket.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClaimTicketView(APIView):
    """Claim a food ticket (full or partial).

    Accepts optional adults_meat, adults_veg, children_count in the request body
    to allow buying a subset of the offered portions. If all amounts match the
    ticket, the ticket is claimed in full (existing behaviour). For a partial
    claim the original ticket is reduced and a new claimed ticket is created for
    the buyer.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        with transaction.atomic():
            try:
                ticket = FoodTicket.objects.select_for_update().get(pk=pk)
            except FoodTicket.DoesNotExist:
                return Response(
                    {"detail": "Ticket not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if not ticket.is_available:
                return Response(
                    {"detail": "This ticket is no longer available."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if ticket.date < timezone.now().date():
                return Response(
                    {"detail": "Cannot claim ticket for past dates."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if ticket.house_id == request.user.house_id:
                return Response(
                    {"detail": "Du kan ikke købe dit eget hus' billet."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Determine requested amounts — default to full ticket
            try:
                adults_meat = (
                    int(request.data["adults_meat"])
                    if "adults_meat" in request.data
                    else ticket.adults_meat
                )
                adults_veg = (
                    int(request.data["adults_veg"])
                    if "adults_veg" in request.data
                    else ticket.adults_veg
                )
                children_count = (
                    int(request.data["children_count"])
                    if "children_count" in request.data
                    else ticket.children_count
                )
            except (ValueError, TypeError):
                return Response(
                    {"detail": "Ugyldige portionsantal."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if adults_meat < 0 or adults_veg < 0 or children_count < 0:
                return Response(
                    {"detail": "Portioner skal være positive tal."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if adults_meat + adults_veg + children_count == 0:
                return Response(
                    {"detail": "Mindst én portion skal vælges."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if (
                adults_meat > ticket.adults_meat
                or adults_veg > ticket.adults_veg
                or children_count > ticket.children_count
            ):
                return Response(
                    {"detail": "Kan ikke købe flere portioner end udbudt."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            is_full_claim = (
                adults_meat == ticket.adults_meat
                and adults_veg == ticket.adults_veg
                and children_count == ticket.children_count
            )

            if is_full_claim:
                ticket.is_available = False
                ticket.claimed_by = request.user
                ticket.claimed_at = timezone.now()
                ticket.save()
                claimed_ticket = ticket
            else:
                # Partial claim: reduce original ticket, create new claimed ticket
                is_free_ticket = ticket.is_free
                remaining_meat = ticket.adults_meat - adults_meat
                remaining_veg = ticket.adults_veg - adults_veg
                remaining_children = ticket.children_count - children_count
                ticket.adults_meat = remaining_meat
                ticket.adults_veg = remaining_veg
                ticket.children_count = remaining_children
                # One lookup for both halves of the split — same meal date.
                prices = get_prices(ticket.date)
                ticket.price = (
                    None
                    if is_free_ticket
                    else prices.total(remaining_meat, remaining_veg, remaining_children)
                )
                ticket.save()

                claimed_ticket = FoodTicket.objects.create(
                    house=ticket.house,
                    owner=ticket.owner,
                    date=ticket.date,
                    adults_meat=adults_meat,
                    adults_veg=adults_veg,
                    children_count=children_count,
                    price=(
                        None
                        if is_free_ticket
                        else prices.total(adults_meat, adults_veg, children_count)
                    ),
                    description=ticket.description,
                    is_available=False,
                    claimed_by=request.user,
                    claimed_at=timezone.now(),
                )

        # Notify the owner that their ticket was claimed (skip if claiming own ticket)
        if ticket.owner != request.user:
            from apps.notifications.services import notify_ticket_claimed

            notify_ticket_claimed(
                owner=ticket.owner,
                claimer=request.user,
                ticket_date=claimed_ticket.date.strftime("%A, %b %d"),
            )

        serializer = FoodTicketSerializer(claimed_ticket, context={"request": request})
        return Response(serializer.data)


class ReleaseTicketView(APIView):
    """Release a claimed food ticket."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            ticket = FoodTicket.objects.get(pk=pk)
        except FoodTicket.DoesNotExist:
            return Response(
                {"detail": "Ticket not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if ticket.claimed_by != request.user and ticket.house_id != request.user.house_id:
            return Response(
                {
                    "detail": "You can only release tickets you claimed or that belong to your house."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if ticket.is_available:
            return Response(
                {"detail": "This ticket is not claimed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ticket.is_available = True
        ticket.claimed_by = None
        ticket.claimed_at = None
        ticket.save()

        serializer = FoodTicketSerializer(ticket, context={"request": request})
        return Response(serializer.data)


class MyTicketsView(generics.ListAPIView):
    """List tickets belonging to the current user's house or claimed by the user."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTicketSerializer

    def get_queryset(self) -> QuerySet[FoodTicket]:
        today = timezone.now().date()
        user = self.request.user
        house_q = Q(house=user.house) if user.house_id else Q(pk__in=[])
        return (
            FoodTicket.objects.filter(house_q | Q(claimed_by=user))
            .exclude(is_available=True, date__lt=today)
            .select_related("owner", "claimed_by")
        )


# Food Team Views


class FoodTeamListView(generics.ListAPIView):
    """List all food teams with optional date filtering."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTeamListSerializer

    def get_queryset(self) -> QuerySet[FoodTeam]:
        queryset = FoodTeam.objects.prefetch_related("members__user")

        # Filter by date range if provided
        from_date = self.request.query_params.get("from_date")
        to_date = self.request.query_params.get("to_date")

        if from_date:
            with contextlib.suppress(ValueError):
                queryset = queryset.filter(date__gte=date.fromisoformat(from_date))

        if to_date:
            with contextlib.suppress(ValueError):
                queryset = queryset.filter(date__lte=date.fromisoformat(to_date))

        # Default to show upcoming teams only
        if not from_date and not to_date:
            queryset = queryset.filter(date__gte=timezone.now().date())

        return queryset


class FoodTeamDetailView(generics.RetrieveAPIView):
    """Get details of a specific food team."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTeamSerializer
    queryset = FoodTeam.objects.prefetch_related("members__user")


class MyTeamsView(generics.ListAPIView):
    """List food teams where the current user is a member."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTeamSerializer

    def get_queryset(self) -> QuerySet[FoodTeam]:
        return (
            FoodTeam.objects.filter(members__user=self.request.user)
            .prefetch_related("members__user")
            .distinct()
        )


class SwapRequestListCreateView(generics.ListCreateAPIView):
    """List swap requests or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return CreateSwapRequestSerializer
        return TeamSwapRequestSerializer

    def get_queryset(self) -> QuerySet[TeamSwapRequest]:
        # Show requests where user is either requester or target
        return (
            TeamSwapRequest.objects.filter(
                Q(requester=self.request.user) | Q(target_membership__user=self.request.user)
            )
            .select_related(
                "requester",
                "requester_membership__user",
                "requester_membership__team",
                "target_membership__user",
                "target_membership__team",
            )
            .order_by("-created_at")
        )


class SwapRequestDetailView(generics.RetrieveDestroyAPIView):
    """Get or cancel a swap request."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TeamSwapRequestSerializer

    def get_queryset(self) -> QuerySet[TeamSwapRequest]:
        return TeamSwapRequest.objects.filter(
            Q(requester=self.request.user) | Q(target_membership__user=self.request.user)
        ).select_related(
            "requester",
            "requester_membership__user",
            "requester_membership__team",
            "target_membership__user",
            "target_membership__team",
        )

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        swap_request = self.get_object()

        # Only requester can cancel
        if swap_request.requester != request.user:
            return Response(
                {"detail": "Only the requester can cancel a swap request."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if swap_request.status != SwapRequestStatus.PENDING:
            return Response(
                {"detail": "Can only cancel pending requests."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        swap_request.status = SwapRequestStatus.CANCELLED
        swap_request.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class RespondSwapRequestView(APIView):
    """Accept or decline a swap request."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            swap_request = TeamSwapRequest.objects.select_related(
                "requester_membership__user",
                "requester_membership__team",
                "target_membership__user",
                "target_membership__team",
            ).get(pk=pk)
        except TeamSwapRequest.DoesNotExist:
            return Response(
                {"detail": "Swap request not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Only target user can respond
        if swap_request.target_membership.user != request.user:
            return Response(
                {"detail": "Only the target user can respond to this request."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if swap_request.status != SwapRequestStatus.PENDING:
            return Response(
                {"detail": "This request has already been processed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = RespondSwapRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        action = serializer.validated_data["action"]
        response_message = serializer.validated_data.get("response_message", "")

        if action == "decline":
            swap_request.status = SwapRequestStatus.DECLINED
            swap_request.response_message = response_message
            swap_request.save()

            return Response(
                TeamSwapRequestSerializer(swap_request, context={"request": request}).data
            )

        # Accept: perform the swap atomically
        with transaction.atomic():
            requester_membership = swap_request.requester_membership
            target_membership = swap_request.target_membership

            # Re-check inside the transaction: memberships may have moved via a
            # takeover or another swap since this request was created.
            from .utils import membership_swap_conflict

            conflict = membership_swap_conflict(requester_membership, target_membership)
            if conflict:
                return Response({"detail": conflict}, status=status.HTTP_400_BAD_REQUEST)

            # Swap the users between teams
            requester_user = requester_membership.user
            requester_house = requester_membership.house_number
            target_user = target_membership.user
            target_house = target_membership.house_number

            requester_membership.user = target_user
            requester_membership.house_number = target_house
            target_membership.user = requester_user
            target_membership.house_number = requester_house

            requester_membership.save()
            target_membership.save()

            swap_request.status = SwapRequestStatus.ACCEPTED
            swap_request.response_message = response_message
            swap_request.save()

            # Cancel any other pending requests involving these memberships
            TeamSwapRequest.objects.filter(status=SwapRequestStatus.PENDING).filter(
                Q(requester_membership__in=[requester_membership, target_membership])
                | Q(target_membership__in=[requester_membership, target_membership])
            ).exclude(pk=swap_request.pk).update(status=SwapRequestStatus.CANCELLED)

        return Response(TeamSwapRequestSerializer(swap_request, context={"request": request}).data)


# Food Team Cycle Views


class FoodTeamCycleListCreateView(generics.ListCreateAPIView):
    """List all cycles or create a new one (admin only for create)."""

    queryset = FoodTeamCycle.objects.all().order_by("-created_at")

    def get_permissions(self) -> list:
        if self.request.method == "POST":
            return [permissions.IsAuthenticated(), IsFoodAdmin()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FoodTeamCycleCreateSerializer
        return FoodTeamCycleSerializer


class FoodTeamCycleDetailView(generics.RetrieveUpdateAPIView):
    """Get or update a food team cycle."""

    queryset = FoodTeamCycle.objects.all()

    def get_permissions(self) -> list:
        if self.request.method in ["PUT", "PATCH"]:
            return [permissions.IsAuthenticated(), IsFoodAdmin()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return FoodTeamCycleCreateSerializer
        return FoodTeamCycleSerializer


class ActiveCycleView(APIView):
    """Get the currently active cycle (accepting wishes)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        from .models import CycleStatus

        # Get the most recent cycle that is accepting wishes
        cycle = (
            FoodTeamCycle.objects.filter(status=CycleStatus.COLLECTING_WISHES)
            .order_by("-created_at")
            .first()
        )

        if not cycle:
            return Response(
                {"detail": "No active or upcoming cycle found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = FoodTeamCycleSerializer(cycle, context={"request": request})
        return Response(serializer.data)


class SuggestedCyclePlanView(APIView):
    """Defaults for the "Opret periode" admin form.

    Suggests the next cycle's cooking dates (Mon–Thu, skipping closed days,
    continuing after the latest existing cycle), a sensible number of days
    derived from the live eligible-cook count, a Danish name, and a wish
    deadline. All values are editable in the UI before saving.
    """

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def get(self, request: Request) -> Response:
        from datetime import datetime, time, timedelta

        from .services import cycle_planning as planning

        eligible = planning.eligible_food_team_count()
        day_count = planning.suggested_day_count(eligible)
        cooking_dates = planning.next_cooking_dates(day_count)
        name = planning.suggest_cycle_name(cooking_dates)

        # Deadline: a week out, but always before the first cooking day so the
        # period is still open for wishes when it starts.
        now = timezone.now()
        deadline = now + timedelta(days=7)
        if cooking_dates:
            first = datetime.combine(date.fromisoformat(cooking_dates[0]), time(23, 59))
            first = timezone.make_aware(first, timezone.get_current_timezone())
            day_before = first - timedelta(days=1)
            if day_before < deadline:
                deadline = max(now + timedelta(hours=1), day_before)

        return Response(
            {
                "eligible_count": eligible,
                "suggested_day_count": day_count,
                "name": name,
                "cooking_dates": cooking_dates,
                "wish_deadline": deadline.isoformat(),
            }
        )


# Food Team Wish Views


class MyWishView(APIView):
    """Get or create/update the current user's wish for a cycle."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, cycle_id: int) -> Response:
        try:
            cycle = FoodTeamCycle.objects.get(id=cycle_id)
        except FoodTeamCycle.DoesNotExist:
            return Response(
                {"detail": "Cycle not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            wish = FoodTeamWish.objects.get(cycle=cycle, user=request.user)
            serializer = FoodTeamWishSerializer(wish, context={"request": request})
            return Response(serializer.data)
        except FoodTeamWish.DoesNotExist:
            return Response(
                {"detail": "No wish submitted for this cycle."},
                status=status.HTTP_404_NOT_FOUND,
            )

    def post(self, request: Request, cycle_id: int) -> Response:
        try:
            cycle = FoodTeamCycle.objects.get(id=cycle_id)
        except FoodTeamCycle.DoesNotExist:
            return Response(
                {"detail": "Cycle not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Add cycle to request data
        data = request.data.copy()
        data["cycle"] = cycle.id

        serializer = FoodTeamWishCreateUpdateSerializer(
            data=data,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        wish = serializer.save()

        return Response(
            FoodTeamWishSerializer(wish, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CycleWishesListView(generics.ListAPIView):
    """List all wishes for a cycle (admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]
    serializer_class = FoodTeamWishSerializer

    def get_queryset(self) -> QuerySet[FoodTeamWish]:
        cycle_id = self.kwargs.get("cycle_id")
        return (
            FoodTeamWish.objects.filter(cycle_id=cycle_id)
            .select_related("user")
            .order_by("user__first_name")
        )


# Team Generation View


class GenerateTeamsView(APIView):
    """Generate food teams for a cycle."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def post(self, request: Request) -> Response:
        serializer = GenerateTeamsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        cycle_id = serializer.validated_data["cycle_id"]
        dry_run = serializer.validated_data.get("dry_run", False)

        try:
            cycle = FoodTeamCycle.objects.get(id=cycle_id)
        except FoodTeamCycle.DoesNotExist:
            return Response(
                {"detail": "Cycle not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Run team generation
        generator = TeamGenerator(cycle)
        result = generator.generate(save=not dry_run)

        # Always return 200 with the structured result. A run that "completes
        # with problems" (unplaced people / undersized teams -> success=False)
        # is not a client error: the request was valid and the generator did
        # produce an outcome (teams_created, unassigned_persons, warnings). The
        # frontend branches on result.success to show the "Holdgenerering
        # resultat" modal either way. Reserving non-2xx for problematic runs
        # would route them to a raw error toast and hide the modal.
        return Response(TeamGenerationResultSerializer(result).data)


class DefaultCookingDaysView(APIView):
    """Get or update the current user's default cooking days preference."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Get the user's default cooking days."""
        return Response({"default_cooking_days": request.user.default_cooking_days})

    def put(self, request: Request) -> Response:
        """Update the user's default cooking days."""
        serializer = DefaultCookingDaysSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request.user.default_cooking_days = serializer.validated_data["default_cooking_days"]
        request.user.save(update_fields=["default_cooking_days"])

        return Response({"default_cooking_days": request.user.default_cooking_days})


def _parse_date_range(request: Request, default_weeks: int) -> tuple[date, date] | Response:
    """Parse start_date/end_date query params, defaulting to the last N full weeks ending today."""
    start_str = request.query_params.get("start_date")
    end_str = request.query_params.get("end_date")
    today = timezone.localdate()
    if not start_str and not end_str:
        # Default: the last `default_weeks` ISO weeks ending with the current week.
        monday_this_week = today - timedelta(days=today.weekday())
        start = monday_this_week - timedelta(weeks=default_weeks - 1)
        end = monday_this_week + timedelta(days=6)
        return start, end
    try:
        start = (
            date.fromisoformat(start_str) if start_str else today - timedelta(weeks=default_weeks)
        )
        end = date.fromisoformat(end_str) if end_str else today
    except ValueError:
        return Response(
            {"detail": "start_date and end_date must be ISO dates (YYYY-MM-DD)."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if end < start:
        return Response(
            {"detail": "end_date must be on or after start_date."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return start, end


class MonthlyFoodCostView(APIView):
    """Food cost breakdown per house over a date range (food or economy admin)."""

    permission_classes = [permissions.IsAuthenticated, IsFoodOrEconomyAdmin]

    def get(self, request: Request) -> Response:
        parsed = _parse_date_range(request, default_weeks=4)
        if isinstance(parsed, Response):
            return parsed
        first_day, last_day = parsed

        from decimal import Decimal

        from apps.houses.models import House

        # Get all houses
        houses = House.objects.prefetch_related("inhabitants")
        house_costs = []
        total_cost = Decimal("0.00")

        # Collect Mon-Thu dates in the month where the deadline has already passed
        from .utils import get_closed_food_dates

        billing_dates: list[date] = []
        current = first_day
        while current <= last_day:
            if current.weekday() <= 3 and is_after_deadline(current):
                billing_dates.append(current)
            current += timedelta(days=1)

        # Exclude closed food days from billing
        closed = get_closed_food_dates(billing_dates)
        billing_dates = [d for d in billing_dates if d not in closed]

        # Safety net: materialize any missing registrations before computing costs.
        # The periodic Huey task should have already done this, but if it missed any
        # dates (e.g. downtime), this ensures billing never falls back to mutable
        # preferences which could retroactively change costs.
        from .tasks import _materialize_for_houses

        _materialize_for_houses(billing_dates)

        # Prices are resolved per meal date, so a price change only affects meals
        # served on or after its start date — past reports stay untouched.
        schedule = get_price_schedule()

        for house in houses:
            house_total = Decimal("0.00")
            registration_count = 0
            adult_meat_portions = 0
            adult_veg_portions = 0
            child_portions = 0

            # One registration per house per date — no dedup needed
            regs_by_date: dict[date, MealRegistration] = {}
            for reg in MealRegistration.objects.filter(
                house=house,
                date__gte=first_day,
                date__lte=last_day,
            ):
                regs_by_date[reg.date] = reg

            for billing_date in billing_dates:
                if billing_date not in regs_by_date:
                    continue
                reg = regs_by_date[billing_date]
                if not reg.is_active:
                    continue
                meat = reg.adults_meat
                veg = reg.adults_veg
                children = reg.children_count

                if meat == 0 and veg == 0 and children == 0:
                    continue
                cost = schedule.for_date(billing_date).total(meat, veg, children)
                house_total += cost
                registration_count += 1
                adult_meat_portions += meat
                adult_veg_portions += veg
                child_portions += children

            house_costs.append(
                {
                    "house_id": house.id,
                    "house_name": house.name,
                    "total_cost": house_total,
                    "registration_count": registration_count,
                    "adult_meat_portions": adult_meat_portions,
                    "adult_veg_portions": adult_veg_portions,
                    "child_portions": child_portions,
                }
            )
            total_cost += house_total

        # Sort by house number numerically (extract trailing number from name)
        import re

        def _house_sort_key(h: dict) -> int:
            m = re.search(r"(\d+)$", h["house_name"])
            return int(m.group(1)) if m else 0

        house_costs.sort(key=_house_sort_key)

        result = {
            "start_date": first_day.isoformat(),
            "end_date": last_day.isoformat(),
            "total_cost": total_cost,
            "houses": house_costs,
        }

        if request.query_params.get("download") == "csv":
            import csv
            import io

            from django.http import HttpResponse

            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(["Hus", "Total pris"])
            for h in house_costs:
                m = re.search(r"(\d+)$", h["house_name"])
                house_num = m.group(1) if m else h["house_name"]
                writer.writerow([house_num, f"{h['total_cost']:.0f}"])
            resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = (
                f'attachment; filename="madomkostninger_{first_day}_{last_day}.csv"'
            )
            return resp

        return Response(MonthlyFoodCostReportSerializer(result).data)


class MyMonthlyExpensesView(APIView):
    """Get weekly food expense breakdown for the authenticated user's house."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        parsed = _parse_date_range(request, default_weeks=5)
        if isinstance(parsed, Response):
            return parsed
        first_day, last_day = parsed

        house = request.user.house
        if not house:
            return Response(
                {"detail": "Du er ikke tilknyttet et hus."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from decimal import Decimal

        from .utils import get_closed_food_dates

        # Collect Mon-Thu dates where deadline has passed
        billing_dates: list[date] = []
        current = first_day
        while current <= last_day:
            if current.weekday() <= 3 and is_after_deadline(current):
                billing_dates.append(current)
            current += timedelta(days=1)

        closed = get_closed_food_dates(billing_dates)
        billing_dates = [d for d in billing_dates if d not in closed]

        # Materialize any missing registrations
        from .tasks import _materialize_for_houses

        _materialize_for_houses(billing_dates)

        regs_by_date: dict[date, MealRegistration] = {}
        for reg in MealRegistration.objects.filter(
            house=house,
            date__gte=first_day,
            date__lte=last_day,
        ):
            regs_by_date[reg.date] = reg

        weeks_map: dict[tuple[int, int], dict] = {}
        total_cost = Decimal("0.00")
        schedule = get_price_schedule()

        for billing_date in billing_dates:
            iso_year, iso_week, _ = billing_date.isocalendar()
            key = (iso_year, iso_week)
            if key not in weeks_map:
                monday = billing_date - timedelta(days=billing_date.weekday())
                weeks_map[key] = {
                    "year": iso_year,
                    "week_number": iso_week,
                    "week_start": monday.isoformat(),
                    "week_end": (monday + timedelta(days=6)).isoformat(),
                    "total_cost": Decimal("0.00"),
                    "days": [],
                }
            week_entry = weeks_map[key]

            if billing_date not in regs_by_date:
                continue
            reg = regs_by_date[billing_date]
            if not reg.is_active:
                continue
            meat = reg.adults_meat
            veg = reg.adults_veg
            children = reg.children_count
            if meat == 0 and veg == 0 and children == 0:
                continue
            cost = schedule.for_date(billing_date).total(meat, veg, children)
            total_cost += cost
            week_entry["total_cost"] += cost
            week_entry["days"].append(
                {
                    "date": billing_date.isoformat(),
                    "day_name": DAY_NAMES[billing_date.weekday()],
                    "adults_meat": meat,
                    "adults_veg": veg,
                    "children_count": children,
                    "cost": str(cost),
                }
            )

        weeks = sorted(weeks_map.values(), key=lambda w: (w["year"], w["week_number"]))
        for w in weeks:
            w["total_cost"] = str(w["total_cost"])

        tickets: list[dict[str, Any]] = []
        sold_qs = (
            FoodTicket.objects.filter(
                house=house,
                date__gte=first_day,
                date__lte=last_day,
                claimed_by__isnull=False,
            )
            .exclude(claimed_by__house=house)
            .select_related("claimed_by__house", "owner")
        )
        for t in sold_qs:
            tickets.append(
                {
                    "id": t.id,
                    "date": t.date.isoformat(),
                    "direction": "sold",
                    "adults_meat": t.adults_meat,
                    "adults_veg": t.adults_veg,
                    "children_count": t.children_count,
                    "price": str(t.price) if t.price is not None else None,
                    "counterparty_house": (
                        t.claimed_by.house.name if t.claimed_by and t.claimed_by.house else ""
                    ),
                }
            )
        bought_qs = (
            FoodTicket.objects.filter(
                date__gte=first_day,
                date__lte=last_day,
                claimed_by__isnull=False,
                claimed_by__house=house,
            )
            .exclude(house=house)
            .select_related("house")
        )
        for t in bought_qs:
            tickets.append(
                {
                    "id": t.id,
                    "date": t.date.isoformat(),
                    "direction": "bought",
                    "adults_meat": t.adults_meat,
                    "adults_veg": t.adults_veg,
                    "children_count": t.children_count,
                    "price": str(t.price) if t.price is not None else None,
                    "counterparty_house": t.house.name if t.house else "",
                }
            )
        tickets.sort(key=lambda x: x["date"])

        return Response(
            {
                "start_date": first_day.isoformat(),
                "end_date": last_day.isoformat(),
                "house_name": house.name,
                "total_cost": str(total_cost),
                "weeks": weeks,
                "tickets": tickets,
            }
        )


# Drive Menu Views


class DriveMenuView(APIView):
    """
    Get menus from Google Drive.

    GET: Returns the current week's menu (or specified week)
    POST: Force refresh from Google Drive (admin only)
    """

    def get_permissions(self) -> list:
        if self.request.method == "POST":
            return [permissions.IsAuthenticated(), IsFoodAdmin()]
        return [permissions.IsAuthenticated()]

    def get(self, request: Request) -> Response:
        """Get menu for a week."""
        # Get week_number and year from query params
        week_number = request.query_params.get("week")
        year = request.query_params.get("year")

        if week_number:
            try:
                week_number = int(week_number)
            except ValueError:
                return Response(
                    {"detail": "Invalid week number."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if year:
            try:
                year = int(year)
            except ValueError:
                return Response(
                    {"detail": "Invalid year."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        from .services.drive_menu import DriveMenuService

        service = DriveMenuService()

        try:
            if week_number:
                menu = service.get_menu_for_week(week_number, year)
            else:
                menu = service.get_current_week_menu()

            if menu:
                return Response(DriveMenuCacheSerializer(menu).data)
            else:
                return Response(
                    {"detail": "No menu found for this week."},
                    status=status.HTTP_404_NOT_FOUND,
                )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:
            logger.exception("Error fetching menu")
            return Response(
                {"detail": "Error fetching menu. Please try again later."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def post(self, request: Request) -> Response:
        """Force refresh menu from Google Drive (admin only)."""
        week_number = request.data.get("week")
        year = request.data.get("year")

        from .services.drive_menu import DriveMenuService

        service = DriveMenuService()

        try:
            if week_number:
                week_number = int(week_number)
                menu = service.get_menu_for_week(week_number, year, force_refresh=True)
                if menu:
                    return Response(DriveMenuCacheSerializer(menu).data)
                else:
                    return Response(
                        {"detail": "No menu found for this week."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
            else:
                # Refresh current week
                menu = service.get_current_week_menu(force_refresh=True)
                if menu:
                    return Response(DriveMenuCacheSerializer(menu).data)
                else:
                    return Response(
                        {"detail": "No menu found for current week."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception:
            logger.exception("Error refreshing menu")
            return Response(
                {"detail": "Error refreshing menu. Please try again later."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class DriveMenuRefreshAllView(APIView):
    """Refresh all menus from Google Drive (admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def post(self, request: Request) -> Response:
        """Refresh all available menus from Drive (runs in background)."""

        from apps.notifications.tasks import refresh_all_drive_menus_task

        refresh_all_drive_menus_task()

        return Response(
            {"detail": "Menu refresh started in background."},
            status=status.HTTP_202_ACCEPTED,
        )


# ── Closed Food Days ──────────────────────────────────────────────


class ClosedFoodDayListCreateView(APIView):
    """List and create closed food days."""

    def get_permissions(self) -> list:
        if self.request.method == "POST":
            return [permissions.IsAuthenticated(), IsFoodAdmin()]
        return [permissions.IsAuthenticated()]

    def get(self, request: Request) -> Response:
        qs = ClosedFoodDay.objects.all()
        from_date = request.query_params.get("from_date")
        to_date = request.query_params.get("to_date")
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)
        return Response(ClosedFoodDaySerializer(qs, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = ClosedFoodDayCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        created = serializer.save()
        return Response(
            ClosedFoodDaySerializer(created, many=True).data,
            status=status.HTTP_201_CREATED,
        )


class ClosedFoodDayDeleteView(APIView):
    """Delete (reopen) a closed food day. Admin only."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def delete(self, request: Request, pk: int) -> Response:
        try:
            obj = ClosedFoodDay.objects.get(pk=pk)
        except ClosedFoodDay.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Madhold launch: today's action box, take-away/leftovers, takeover,          #
# broadcast swaps, favours, personal profile, admin roster                    #
# --------------------------------------------------------------------------- #


def _danish_date_label(d: date) -> str:
    """e.g. 'Mandag 8/6'."""
    return f"{DAY_NAMES[d.weekday()]} {d.day}/{d.month}"


def _house_number_for(user) -> str:  # type: ignore[no-untyped-def]
    """Cached display house number for a user (e.g. '5' from 'House 5')."""
    if not user.house:
        return ""
    return str(user.house.name).replace("House ", "")


class TodayTeamActionBoxView(APIView):
    """Fast data for the dashboard action box (no Drive calls).

    Recipe folder + per-dish links live on the sibling
    ``TodayTeamRecipesView`` so the dashboard widget can render members and
    buttons immediately and lazily fill in the recipe section with skeletons.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        today = timezone.localdate()
        team = (
            FoodTeam.objects.filter(date=today)
            .prefetch_related("members__user")
            .select_related("cycle")
            .first()
        )
        if not team:
            return Response({"on_team": False, "has_team_today": False})

        on_team = team.members.filter(user_id=request.user.id).exists()
        members = FoodTeamMemberSerializer(
            team.members.all(), many=True, context={"request": request}
        ).data

        return Response(
            {
                "on_team": on_team,
                "has_team_today": True,
                "team_id": team.id,
                "date": today.isoformat(),
                "day_name": team.day_name,
                "members": members,
            }
        )


class TodayTeamRecipesView(APIView):
    """Drive-backed recipe info for today's team.

    Split out from :class:`TodayTeamActionBoxView` so the dashboard widget can
    render the team and buttons immediately while these (potentially slow,
    Drive-API-backed) fields fill in afterwards. Cached on the DriveMenuCache
    row, so steady-state calls are fast.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        today = timezone.localdate()
        from .models import DriveMenuCache
        from .services.recipe_sheets import RecipeSheetService, folder_url

        iso = today.isocalendar()
        cache = DriveMenuCache.objects.filter(week_number=iso[1], year=iso[0]).first()
        recipe_folder_url = (
            folder_url(cache.drive_folder_id) if cache and cache.drive_folder_id else ""
        )
        # File-level link (the recipe spreadsheet itself). For .xlsx files in
        # Drive we can't deep-link to a specific tab via developerKey-auth, so
        # we surface this as the single "Åbn opskriftsark" fallback button.
        recipe_file_url = ""
        if cache and cache.recipe_file_id:
            recipe_file_url = f"https://docs.google.com/spreadsheets/d/{cache.recipe_file_id}/edit"

        recipes: list[dict] = []
        with contextlib.suppress(Exception):
            recipes = RecipeSheetService().recipes_for_date(today)

        # "Dagens forside": today's section of the week's menu document.
        front_page = None
        with contextlib.suppress(Exception):
            from .services.drive_menu import DriveMenuService

            front_page = DriveMenuService().front_page_for_date(today)

        return Response(
            {
                "recipe_folder_url": recipe_folder_url,
                "recipe_file_url": recipe_file_url,
                "recipes": recipes,
                "front_page": front_page,
            }
        )


class WeekRecipesView(APIView):
    """All recipes for a week, for the standalone "Ugens opskrifter" page.

    Unlike :class:`TodayTeamRecipesView` this is not gated on team membership
    and returns every recipe sheet for the week (all weekdays), so any resident
    can browse the menu's recipes. Accepts ``?week=&year=`` or ``?date=`` (all
    optional; defaults to the current ISO week). Cached on DriveMenuCache.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        from .models import DriveMenuCache
        from .services.drive_menu import DriveMenuService
        from .services.recipe_sheets import RecipeSheetService, folder_url

        # Resolve the target ISO week/year from the query params.
        date_str = request.query_params.get("date")
        week_param = request.query_params.get("week")
        year_param = request.query_params.get("year")
        if date_str:
            try:
                d = date.fromisoformat(date_str)
            except ValueError:
                return Response({"detail": "Ugyldig dato."}, status=status.HTTP_400_BAD_REQUEST)
            iso = d.isocalendar()
            week_number, year = iso[1], iso[0]
        else:
            today = timezone.localdate()
            iso = today.isocalendar()
            try:
                week_number = int(week_param) if week_param else iso[1]
                year = int(year_param) if year_param else iso[0]
            except ValueError:
                return Response({"detail": "Ugyldig uge."}, status=status.HTTP_400_BAD_REQUEST)

        cache = DriveMenuCache.objects.filter(week_number=week_number, year=year).first()
        recipe_folder_url = (
            folder_url(cache.drive_folder_id) if cache and cache.drive_folder_id else ""
        )
        recipe_file_url = ""
        if cache and cache.recipe_file_id:
            recipe_file_url = f"https://docs.google.com/spreadsheets/d/{cache.recipe_file_id}/edit"

        recipes: list[dict] = []
        with contextlib.suppress(Exception):
            recipes = RecipeSheetService().get_recipes_for_week(week_number, year)
        recipes = sorted(recipes, key=lambda r: (r.get("day", 0), r.get("index", 0)))

        front_pages: list[dict] = []
        with contextlib.suppress(Exception):
            front_pages = DriveMenuService().get_front_pages_for_week(week_number, year)

        return Response(
            {
                "week_number": week_number,
                "year": year,
                "recipe_folder_url": recipe_folder_url,
                "recipe_file_url": recipe_file_url,
                "recipes": recipes,
                "front_pages": front_pages,
            }
        )


def _already_notified_today(notification_type: str) -> bool:
    """Soft guard: was a notification of this type already created today?"""
    from apps.notifications.models import Notification

    return Notification.objects.filter(
        notification_type=notification_type,
        created_at__date=timezone.localdate(),
    ).exists()


class NotifyTakeawayReadyView(APIView):
    """Today's team announces that take-away is ready."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            team = FoodTeam.objects.get(pk=pk)
        except FoodTeam.DoesNotExist:
            return Response({"detail": "Madhold ikke fundet."}, status=status.HTTP_404_NOT_FOUND)
        if team.date != timezone.localdate():
            return Response(
                {"detail": "Kun dagens madhold kan sende denne besked."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not team.members.filter(user_id=request.user.id).exists():
            return Response(
                {"detail": "Kun medlemmer af dagens madhold kan sende denne besked."},
                status=status.HTTP_403_FORBIDDEN,
            )
        from apps.notifications.models import NotificationType
        from apps.notifications.tasks import broadcast_takeaway_ready

        if _already_notified_today(NotificationType.FOOD_TEAM_TAKEAWAY_READY):
            return Response({"detail": "Beskeden er allerede sendt i dag.", "sent": False})
        broadcast_takeaway_ready(team.id, request.user.id)
        return Response({"detail": "Besked sendt.", "sent": True})


_ALLOWED_LEFTOVERS_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "heic", "heif", "gif"}


class NotifyLeftoversReadyView(APIView):
    """Today's team announces leftovers, optionally with a photo."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            team = FoodTeam.objects.get(pk=pk)
        except FoodTeam.DoesNotExist:
            return Response({"detail": "Madhold ikke fundet."}, status=status.HTTP_404_NOT_FOUND)
        if team.date != timezone.localdate():
            return Response(
                {"detail": "Kun dagens madhold kan sende denne besked."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not team.members.filter(user_id=request.user.id).exists():
            return Response(
                {"detail": "Kun medlemmer af dagens madhold kan sende denne besked."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Match the takeaway view's once-per-day guard so a double-tap doesn't
        # fan out duplicate community notifications. team.leftovers_announced_at
        # is the per-team marker; treat the existence of any prior announcement
        # today as "already sent".
        if team.leftovers_announced_at is not None:
            return Response({"detail": "Beskeden er allerede sendt i dag.", "sent": False})

        image_url = ""
        image = request.FILES.get("image")
        if image:
            from django.core.files.storage import default_storage

            raw_ext = (image.name.rsplit(".", 1)[-1] if "." in image.name else "jpg").lower()
            ext = raw_ext if raw_ext in _ALLOWED_LEFTOVERS_IMAGE_EXTS else "jpg"
            path = default_storage.save(
                f"food_leftovers/{team.date.isoformat()}_{team.id}.{ext}", image
            )
            from django.conf import settings as dj_settings

            image_url = request.build_absolute_uri(dj_settings.MEDIA_URL + path)

        message = str(request.data.get("message", "")).strip()

        team.leftovers_message = message
        team.leftovers_image_url = image_url
        team.leftovers_announced_at = timezone.now()
        team.save(
            update_fields=["leftovers_message", "leftovers_image_url", "leftovers_announced_at"]
        )

        from apps.notifications.tasks import broadcast_leftovers_ready

        broadcast_leftovers_ready(team.id, request.user.id, image_url, message)
        return Response({"detail": "Besked sendt.", "sent": True})


class TodayLeftoversView(APIView):
    """The most recent 'Rester er klar' announcement for today (any user can read)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        today = timezone.localdate()
        team = (
            FoodTeam.objects.filter(date=today, leftovers_announced_at__isnull=False)
            .prefetch_related("members__user")
            .first()
        )
        if not team:
            return Response({"has_leftovers": False})
        member_names = [m.user.first_name for m in team.members.all()]
        return Response(
            {
                "has_leftovers": True,
                "team_id": team.id,
                "date": today.isoformat(),
                "day_name": team.day_name,
                "members": member_names,
                "message": team.leftovers_message,
                "image_url": team.leftovers_image_url,
                "announced_at": team.leftovers_announced_at,
            }
        )


class TakeoverView(APIView):
    """Take over another user's shift; they owe you a favour next cycle."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = TakeoverSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        membership: FoodTeamMember = serializer.context["target_membership"]
        team = membership.team

        with transaction.atomic():
            # Lock the membership and re-resolve its current user inside the
            # transaction: two concurrent takeovers must not both reassign the
            # same shift (the loser would otherwise get a favour for a shift
            # they don't actually cook).
            try:
                locked_membership = FoodTeamMember.objects.select_for_update().get(pk=membership.pk)
            except FoodTeamMember.DoesNotExist:
                return Response(
                    {"detail": "Madholdsmedlemskab ikke fundet."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if locked_membership.user_id == request.user.id:
                return Response(
                    {"detail": "Du er allerede på dette madhold."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            debtor = locked_membership.user

            # Cancel pending swaps / broadcasts involving this membership.
            TeamSwapRequest.objects.filter(status=SwapRequestStatus.PENDING).filter(
                Q(requester_membership=locked_membership) | Q(target_membership=locked_membership)
            ).update(status=SwapRequestStatus.CANCELLED)
            SwapBroadcast.objects.filter(
                requester_membership=locked_membership, status=BroadcastStatus.OPEN
            ).update(status=BroadcastStatus.CANCELLED)

            locked_membership.user = request.user
            locked_membership.house_number = _house_number_for(request.user)  # ty: ignore[invalid-assignment]
            locked_membership.save()

            favour = TeamFavour.objects.create(
                creditor=request.user,
                debtor=debtor,
                cycle=team.cycle,
                origin_date=team.date,
                note=serializer.validated_data.get("note", ""),
            )

        # Notify the freed user.
        from apps.notifications.services import notify_food_swap_request

        with contextlib.suppress(Exception):
            notify_food_swap_request(
                debtor,
                request.user.first_name,
                _danish_date_label(team.date),
                "/madhold/mine-hold",
                related_user=request.user,
            )

        return Response(
            TeamFavourSerializer(favour, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


def _compute_broadcast_candidates(
    requester, requester_date: date, available_dates: list[date]
) -> list[int]:
    """Users who could plausibly take ``requester_date`` and currently hold a
    membership on one of ``available_dates``."""
    from apps.users.models import User

    cycle = FoodTeam.objects.filter(date=requester_date).values_list("cycle_id", flat=True).first()
    # People currently cooking on a date the requester can take. Filter out
    # inactive or exempt users so we don't notify someone who can't cook now
    # (e.g. opted out after generation but still holds a stale membership).
    holder_ids = set(
        FoodTeamMember.objects.filter(
            team__date__in=available_dates,
            user__is_active=True,
            user__is_exempt_from_food_teams=False,
        )
        .exclude(user=requester)
        .values_list("user_id", flat=True)
    )
    if not holder_ids:
        return []

    weekday = requester_date.weekday()
    # People who indicated availability for requester_date via this cycle's wish.
    wish_user_ids: set[int] = set()
    if cycle:
        for wish in FoodTeamWish.objects.filter(cycle_id=cycle, is_unavailable=False):
            if requester_date.isoformat() in wish.available_dates:
                wish_user_ids.add(wish.user_id)

    # ...or via their default cooking weekday. JSONField __contains is unsupported
    # on SQLite, so check membership in Python (only among current holders).
    weekday_user_ids = {
        uid
        for uid, days in User.objects.filter(id__in=holder_ids).values_list(
            "id", "default_cooking_days"
        )
        if weekday in (days or [])
    }

    eligible = (wish_user_ids | weekday_user_ids) & holder_ids
    # Exclude requester's own house (would collide on requester_date).
    if requester.house_id:
        same_house = set(
            User.objects.filter(house_id=requester.house_id).values_list("id", flat=True)
        )
        eligible -= same_house
    return sorted(eligible)


class SwapBroadcastListCreateView(generics.ListCreateAPIView):
    """List relevant broadcasts or create a new 'bytteanmodning'."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return CreateSwapBroadcastSerializer
        return SwapBroadcastSerializer

    def get_queryset(self) -> QuerySet[SwapBroadcast]:
        user = self.request.user
        # Dates the user currently cooks (so we can surface broadcasts they can accept).
        my_date_strs = {
            d.isoformat()
            for d in FoodTeamMember.objects.filter(user=user).values_list("team__date", flat=True)
        }
        # JSONField list lookups (__contains/__overlap) aren't supported on SQLite,
        # so fetch my own + all recent broadcasts and filter candidacy in Python.
        # IMPORTANT: also include CLOSED (accepted/cancelled) broadcasts where the
        # user was a candidate, so when they click their notification AFTER someone
        # else accepted they can still see "already accepted by X" instead of an
        # empty list. Restrict to recent ones so the list doesn't grow forever.
        from datetime import timedelta

        cutoff = timezone.now() - timedelta(days=14)
        base = (
            SwapBroadcast.objects.filter(Q(requester=user) | Q(created_at__gte=cutoff))
            .select_related("requester", "requester_membership__team", "accepted_by")
            .order_by("-created_at")
        )
        relevant_ids = [
            b.id
            for b in base
            if b.requester_id == user.id
            or user.id in (b.candidate_user_ids or [])
            or (my_date_strs & set(b.available_dates or []))
        ]
        return base.filter(id__in=relevant_ids)

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership: FoodTeamMember = serializer.context["requester_membership"]
        available_dates: list[date] = serializer.validated_data["available_dates"]
        candidates = _compute_broadcast_candidates(
            request.user, membership.team.date, available_dates
        )
        broadcast = SwapBroadcast.objects.create(
            requester=request.user,
            requester_membership=membership,
            available_dates=[d.isoformat() for d in available_dates],
            candidate_user_ids=candidates,
            message=serializer.validated_data.get("message", ""),
        )
        from apps.notifications.tasks import notify_swap_broadcast

        if candidates:
            notify_swap_broadcast(broadcast.id)
        return Response(
            SwapBroadcastSerializer(broadcast, context={"request": request}).data
            | {"candidate_count": len(candidates)},
            status=status.HTTP_201_CREATED,
        )


class SwapBroadcastDetailView(generics.RetrieveDestroyAPIView):
    """Retrieve or cancel a broadcast (requester only)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = SwapBroadcastSerializer

    def get_queryset(self) -> QuerySet[SwapBroadcast]:
        return SwapBroadcast.objects.select_related(
            "requester", "requester_membership__team", "accepted_by"
        )

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        broadcast = self.get_object()
        if broadcast.requester_id != request.user.id:
            return Response(
                {"detail": "Kun afsenderen kan annullere."}, status=status.HTTP_403_FORBIDDEN
            )
        if broadcast.status != BroadcastStatus.OPEN:
            return Response(
                {"detail": "Anmodningen er allerede afsluttet."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        broadcast.status = BroadcastStatus.CANCELLED
        broadcast.save(update_fields=["status", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AcceptSwapBroadcastView(APIView):
    """Accept a broadcast with one of your memberships on an offered date."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            broadcast = SwapBroadcast.objects.select_related(
                "requester_membership__team", "requester"
            ).get(pk=pk)
        except SwapBroadcast.DoesNotExist:
            return Response({"detail": "Ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        if broadcast.status != BroadcastStatus.OPEN:
            return Response(
                {"detail": "Anmodningen er allerede afsluttet."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if broadcast.requester_id == request.user.id:
            return Response(
                {"detail": "Du kan ikke acceptere din egen anmodning."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AcceptSwapBroadcastSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            my_membership = FoodTeamMember.objects.select_related("team").get(
                pk=serializer.validated_data["membership_id"], user=request.user
            )
        except FoodTeamMember.DoesNotExist:
            return Response(
                {"detail": "Dit madholdsmedlemskab blev ikke fundet."},
                status=status.HTTP_404_NOT_FOUND,
            )

        offered = {date.fromisoformat(d) for d in broadcast.available_dates}
        if my_membership.team.date not in offered:
            return Response(
                {"detail": "Den valgte maddag er ikke blandt de ønskede dage."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requester_membership = broadcast.requester_membership
        with transaction.atomic():
            # Lock the broadcast and re-check its status: two candidates
            # accepting simultaneously must not both pass the OPEN check and
            # double-swap the requester's membership.
            try:
                locked_broadcast = SwapBroadcast.objects.select_for_update().get(pk=broadcast.pk)
            except SwapBroadcast.DoesNotExist:
                return Response({"detail": "Ikke fundet."}, status=status.HTTP_404_NOT_FOUND)
            if locked_broadcast.status != BroadcastStatus.OPEN:
                return Response(
                    {"detail": "Anmodningen er allerede afsluttet."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            from .utils import membership_swap_conflict

            conflict = membership_swap_conflict(requester_membership, my_membership)
            if conflict:
                return Response({"detail": conflict}, status=status.HTTP_400_BAD_REQUEST)

            r_user, r_house = requester_membership.user, requester_membership.house_number
            m_user, m_house = my_membership.user, my_membership.house_number
            requester_membership.user, requester_membership.house_number = m_user, m_house
            my_membership.user, my_membership.house_number = r_user, r_house
            requester_membership.save()
            my_membership.save()

            locked_broadcast.status = BroadcastStatus.ACCEPTED
            locked_broadcast.accepted_by = request.user
            locked_broadcast.accepted_membership = my_membership
            locked_broadcast.save(
                update_fields=["status", "accepted_by", "accepted_membership", "updated_at"]
            )
            broadcast = locked_broadcast

            # Tidy up other open offers / pending swaps on these memberships.
            SwapBroadcast.objects.filter(status=BroadcastStatus.OPEN).filter(
                Q(requester_membership__in=[requester_membership, my_membership])
            ).exclude(pk=broadcast.pk).update(status=BroadcastStatus.CANCELLED)
            TeamSwapRequest.objects.filter(status=SwapRequestStatus.PENDING).filter(
                Q(requester_membership__in=[requester_membership, my_membership])
                | Q(target_membership__in=[requester_membership, my_membership])
            ).update(status=SwapRequestStatus.CANCELLED)

        from apps.notifications.services import notify_food_swap_request

        with contextlib.suppress(Exception):
            notify_food_swap_request(
                broadcast.requester,
                request.user.first_name,
                _danish_date_label(requester_membership.team.date),
                "/madhold/bytte",
                related_user=request.user,
            )
        return Response(SwapBroadcastSerializer(broadcast, context={"request": request}).data)


class FavourListView(generics.ListAPIView):
    """Favours where the current user is creditor or debtor."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = TeamFavourSerializer

    def get_queryset(self) -> QuerySet[TeamFavour]:
        return (
            TeamFavour.objects.filter(Q(creditor=self.request.user) | Q(debtor=self.request.user))
            .select_related("creditor", "debtor")
            .order_by("settled", "-created_at")
        )


class FavourSettleView(APIView):
    """Mark a favour as settled (creditor only)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            favour = TeamFavour.objects.get(pk=pk)
        except TeamFavour.DoesNotExist:
            return Response({"detail": "Ikke fundet."}, status=status.HTTP_404_NOT_FOUND)
        if favour.creditor_id != request.user.id:
            return Response(
                {"detail": "Kun den der har tjenesten til gode kan markere den som indfriet."},
                status=status.HTTP_403_FORBIDDEN,
            )
        favour.settled = True
        favour.settled_at = timezone.now()
        favour.save(update_fields=["settled", "settled_at"])
        return Response(TeamFavourSerializer(favour, context={"request": request}).data)


class MyFoodProfileView(generics.RetrieveUpdateAPIView):
    """Self-service food-team profile for the current user."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MyFoodProfileSerializer

    def get_object(self):  # type: ignore[no-untyped-def]
        return self.request.user


class FoodRosterListView(generics.ListAPIView):
    """Admin roster of all users with their food-team flags."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]
    serializer_class = FoodRosterSerializer

    def get_queryset(self) -> QuerySet:
        from apps.users.models import User

        return (
            User.objects.filter(is_active=True)
            .select_related("house")
            .order_by("house__name", "first_name")
        )


class FoodRosterDetailView(generics.UpdateAPIView):
    """Admin: update a single user's food-team flags."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]
    serializer_class = FoodRosterSerializer

    def get_queryset(self) -> QuerySet:
        from apps.users.models import User

        return User.objects.all()


# Meal Prices


class MealPriceListCreateView(APIView):
    """List price sets (everyone) and create new ones (food admin only).

    The full schedule is returned — it is a handful of rows — so the frontend can
    price any date with the same meal-date-anchored logic the backend uses.
    """

    def get_permissions(self) -> list:
        if self.request.method == "POST":
            return [permissions.IsAuthenticated(), IsFoodAdmin()]
        return [permissions.IsAuthenticated()]

    def get(self, request: Request) -> Response:
        qs = MealPrice.objects.select_related("created_by").all()
        return Response(MealPriceSerializer(qs, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = MealPriceSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MealPriceDetailView(APIView):
    """Update or delete a price set that has not taken effect yet. Food admin only.

    Price sets already in effect are immutable — past meals are billed at the
    prices that applied on the day they were served.
    """

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def _get_object(self, pk: int) -> MealPrice | None:
        return MealPrice.objects.filter(pk=pk).select_related("created_by").first()

    def patch(self, request: Request, pk: int) -> Response:
        obj = self._get_object(pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = MealPriceSerializer(
            obj, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request: Request, pk: int) -> Response:
        obj = self._get_object(pk)
        if obj is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if obj.effective_from < timezone.localdate():
            return Response(
                {
                    "detail": (
                        "Prissættet er allerede trådt i kraft og kan ikke slettes. "
                        "Opret i stedet et nyt prissæt med en fremtidig startdato."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if MealPrice.objects.count() <= 1:
            return Response(
                {"detail": "Der skal altid findes mindst ét prissæt."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
