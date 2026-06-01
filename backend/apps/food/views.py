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

from .constants import DAY_NAMES, calculate_meal_price
from .models import (
    ClosedFoodDay,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    SwapRequestStatus,
    TeamSwapRequest,
)
from .serializers import (
    ClosedFoodDayCreateSerializer,
    ClosedFoodDaySerializer,
    CreateSwapRequestSerializer,
    DefaultCookingDaysSerializer,
    DriveMenuCacheSerializer,
    FoodTeamCycleCreateSerializer,
    FoodTeamCycleSerializer,
    FoodTeamListSerializer,
    FoodTeamSerializer,
    FoodTeamWishCreateUpdateSerializer,
    FoodTeamWishSerializer,
    FoodTicketCreateSerializer,
    FoodTicketSerializer,
    GenerateTeamsSerializer,
    MealPreferenceCreateUpdateSerializer,
    MealPreferenceSerializer,
    MealRegistrationCreateUpdateSerializer,
    MealRegistrationSerializer,
    MonthlyFoodCostReportSerializer,
    RespondSwapRequestSerializer,
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
                ticket.price = (
                    None
                    if is_free_ticket
                    else calculate_meal_price(remaining_meat, remaining_veg, remaining_children)
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
                        else calculate_meal_price(adults_meat, adults_veg, children_count)
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

        return Response(
            TeamGenerationResultSerializer(result).data,
            status=status.HTTP_200_OK if result.success else status.HTTP_400_BAD_REQUEST,
        )


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
    """Get food cost breakdown per house over a date range (food admin only)."""

    permission_classes = [permissions.IsAuthenticated, IsFoodAdmin]

    def get(self, request: Request) -> Response:
        parsed = _parse_date_range(request, default_weeks=4)
        if isinstance(parsed, Response):
            return parsed
        first_day, last_day = parsed

        from decimal import Decimal

        from apps.houses.models import House

        from .constants import PRICE_ADULT_MEAT, PRICE_ADULT_VEG, PRICE_CHILD

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
                cost = (
                    (PRICE_ADULT_MEAT * meat) + (PRICE_ADULT_VEG * veg) + (PRICE_CHILD * children)
                )
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
            cost = calculate_meal_price(meat, veg, children)
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
