"""
Views for Food app.
"""

import contextlib
import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.db.models import Max, Q, QuerySet, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
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
    MonthlyFoodCostSerializer,
    RespondSwapRequestSerializer,
    TeamGenerationResultSerializer,
    TeamSwapRequestSerializer,
    is_after_deadline,
)
from .services.team_generator import TeamGenerator

logger = logging.getLogger(__name__)


def get_week_start(d: date) -> date:
    """Get the Monday of the week containing the given date."""
    return d - timedelta(days=d.weekday())


DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag"]


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
        user=user,
        date=target_date,
        defaults={
            "house": house,
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
            stats = {}
            for day in range(4):  # Mon-Thu
                day_date = week_start + timedelta(days=day)
                stats[day_date.isoformat()] = self._get_stats_for_date(day_date)
            return Response(stats)

        else:
            return Response(
                {"detail": "Please provide 'date' or 'week_start' query parameter."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def _get_stats_for_date(self, target_date: date) -> dict[str, Any]:
        """Get registration statistics for a specific date.

        Effective portions = active registrations minus available (unsold) tickets.
        Claimed tickets are NOT subtracted (the claimer eats in place of the seller).

        Deduplication: each house counts once. Multiple users in the same house each
        have their own registration (each containing the full household count), so we
        only keep the most recently created registration per house to avoid double-counting.
        Users without a house are always counted individually.
        """
        # For post-deadline dates, ensure all houses have materialized registrations
        # so stats don't depend on mutable preferences.
        # Only call _materialize_for_houses when rows are actually missing — the
        # periodic Huey task handles the common case, so this is just a safety net.
        if is_after_deadline(target_date):
            from apps.houses.models import House

            from .tasks import _materialize_for_houses

            house_count = House.objects.filter(inhabitants__is_active=True).distinct().count()
            covered = (
                MealRegistration.objects.filter(date=target_date, house__isnull=False)
                .values("house_id")
                .distinct()
                .count()
            )
            if covered < house_count:
                _materialize_for_houses([target_date])

        # For houses with multiple registrations, keep only the latest one (highest id)
        latest_per_house = (
            MealRegistration.objects.filter(date=target_date, is_active=True, house__isnull=False)
            .values("house_id")
            .annotate(latest_id=Max("id"))
            .values("latest_id")
        )
        registrations = MealRegistration.objects.filter(
            date=target_date,
            is_active=True,
        ).filter(Q(house__isnull=True) | Q(id__in=latest_per_house))

        # Aggregate by category
        def _agg(qs: QuerySet) -> dict[str, int]:
            result = qs.aggregate(
                adults_meat=Coalesce(Sum("adults_meat"), 0),
                adults_veg=Coalesce(Sum("adults_veg"), 0),
                children=Coalesce(Sum("children_count"), 0),
            )
            result["adults"] = result["adults_meat"] + result["adults_veg"]
            return result

        takeaway = _agg(registrations.filter(dining_option="take_away"))
        eat_in_1730 = _agg(registrations.filter(dining_option="eat_in", seating_time="17:30"))
        eat_in_1830 = _agg(registrations.filter(dining_option="eat_in", seating_time="18:30"))
        total_agg = _agg(registrations)

        # For pre-deadline dates, add virtual contributions for houses without
        # a real registration. Post-deadline dates already have materialized rows.
        virtual: dict[str, dict[str, int]] = {
            "take_away": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "eat_in_1730": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "eat_in_1830": {"adults_meat": 0, "adults_veg": 0, "children": 0},
            "total": {"adults_meat": 0, "adults_veg": 0, "children": 0},
        }
        if not is_after_deadline(target_date):
            from apps.houses.models import House

            covered_house_ids = set(
                MealRegistration.objects.filter(
                    date=target_date, is_active=True, house__isnull=False
                ).values_list("house_id", flat=True)
            )
            day_of_week = target_date.weekday()
            prefs_by_house: dict[int, MealPreference] = {}
            for pref in MealPreference.objects.filter(
                day_of_week=day_of_week, user__is_active=True
            ).select_related("user__house"):
                house = pref.user.house
                if house and house.id not in prefs_by_house:
                    prefs_by_house[house.id] = pref

            for h in House.objects.prefetch_related("inhabitants"):
                if h.id in covered_house_ids:
                    continue
                pref = prefs_by_house.get(h.id)
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
                    house_count = len(h.inhabitants.all())
                    if house_count == 0:
                        continue
                    meat, veg, children = 0, house_count, 0
                    bucket = "eat_in_1730"
                for b in (bucket, "total"):
                    virtual[b]["adults_meat"] += meat
                    virtual[b]["adults_veg"] += veg
                    virtual[b]["children"] += children

        # Subtract available (unsold) tickets from combined total
        available_tickets = FoodTicket.objects.filter(
            date=target_date, is_available=True
        ).aggregate(
            ticket_meat=Coalesce(Sum("adults_meat"), 0),
            ticket_veg=Coalesce(Sum("adults_veg"), 0),
            ticket_children=Coalesce(Sum("children_count"), 0),
        )
        combined_meat = total_agg["adults_meat"] + virtual["total"]["adults_meat"]
        combined_veg = total_agg["adults_veg"] + virtual["total"]["adults_veg"]
        combined_children = total_agg["children"] + virtual["total"]["children"]
        eff_meat = max(0, combined_meat - available_tickets["ticket_meat"])
        eff_veg = max(0, combined_veg - available_tickets["ticket_veg"])
        eff_children = max(0, combined_children - available_tickets["ticket_children"])

        def _merge(db: dict[str, int], virt: dict[str, int]) -> dict[str, int]:
            m = db["adults_meat"] + virt["adults_meat"]
            v = db["adults_veg"] + virt["adults_veg"]
            c = db["children"] + virt["children"]
            return {"adults": m + v, "adults_meat": m, "adults_veg": v, "children": c}

        return {
            "date": target_date.isoformat(),
            "takeaway": _merge(takeaway, virtual["take_away"]),
            "eat_in_1730": _merge(eat_in_1730, virtual["eat_in_1730"]),
            "eat_in_1830": _merge(eat_in_1830, virtual["eat_in_1830"]),
            "total": {
                "adults": eff_meat + eff_veg,
                "adults_meat": eff_meat,
                "adults_veg": eff_veg,
                "children": eff_children,
            },
        }


# Meal Preference Views
class MealPreferenceListCreateView(generics.ListCreateAPIView):
    """List or create meal preferences for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return MealPreferenceCreateUpdateSerializer
        return MealPreferenceSerializer

    def get_queryset(self) -> QuerySet[MealPreference]:
        return MealPreference.objects.filter(user=self.request.user)


class MealPreferenceDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Get, update, or delete a meal preference."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return MealPreferenceCreateUpdateSerializer
        return MealPreferenceSerializer

    def get_queryset(self) -> QuerySet[MealPreference]:
        return MealPreference.objects.filter(user=self.request.user)


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
        queryset = MealRegistration.objects.filter(user=self.request.user).select_related("house")
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
        prefs = {p.day_of_week: p for p in MealPreference.objects.filter(user=user)}

        results = []
        for day in range(4):
            target_date = week_start + timedelta(days=day)
            if target_date in real_regs:
                results.append(
                    MealRegistrationSerializer(
                        real_regs[target_date], context={"request": request}
                    ).data
                )
            elif is_after_deadline(target_date):
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
        return MealRegistration.objects.filter(user=self.request.user).select_related("house")


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
        if ticket.owner != request.user:
            return Response(
                {"detail": "You can only delete your own tickets."},
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

    # Default prices — keep in sync with FoodTicketCreateSerializer and frontend
    _PRICE_ADULT_MEAT = Decimal("37.00")
    _PRICE_ADULT_VEG = Decimal("26.00")
    _PRICE_CHILD = Decimal("18.00")

    def _calc_price(self, meat: int, veg: int, children: int) -> Decimal:
        return (
            self._PRICE_ADULT_MEAT * meat
            + self._PRICE_ADULT_VEG * veg
            + self._PRICE_CHILD * children
        )

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
                    else self._calc_price(remaining_meat, remaining_veg, remaining_children)
                )
                ticket.save()

                claimed_ticket = FoodTicket.objects.create(
                    owner=ticket.owner,
                    date=ticket.date,
                    adults_meat=adults_meat,
                    adults_veg=adults_veg,
                    children_count=children_count,
                    price=(
                        None
                        if is_free_ticket
                        else self._calc_price(adults_meat, adults_veg, children_count)
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

        if ticket.claimed_by != request.user and ticket.owner != request.user:
            return Response(
                {"detail": "You can only release tickets you claimed or own."},
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
    """List tickets owned by or claimed by the current user."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTicketSerializer

    def get_queryset(self) -> QuerySet[FoodTicket]:
        return FoodTicket.objects.filter(
            Q(owner=self.request.user) | Q(claimed_by=self.request.user)
        ).select_related("owner", "claimed_by")


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

    permission_classes = [permissions.IsAuthenticated]
    queryset = FoodTeamCycle.objects.all().order_by("-created_at")

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return FoodTeamCycleCreateSerializer
        return FoodTeamCycleSerializer

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Only staff can create cycles
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can create food team cycles."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().create(request, *args, **kwargs)


class FoodTeamCycleDetailView(generics.RetrieveUpdateAPIView):
    """Get or update a food team cycle."""

    permission_classes = [permissions.IsAuthenticated]
    queryset = FoodTeamCycle.objects.all()

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return FoodTeamCycleCreateSerializer
        return FoodTeamCycleSerializer

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Only staff can update cycles
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can update food team cycles."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)


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

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FoodTeamWishSerializer

    def get_queryset(self) -> QuerySet[FoodTeamWish]:
        cycle_id = self.kwargs.get("cycle_id")
        return (
            FoodTeamWish.objects.filter(cycle_id=cycle_id)
            .select_related("user")
            .order_by("user__first_name")
        )

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Only staff can view all wishes
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can view all wishes."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().list(request, *args, **kwargs)


# Team Generation View


class GenerateTeamsView(APIView):
    """Generate food teams for a cycle."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        # Only staff can generate teams
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can generate food teams."},
                status=status.HTTP_403_FORBIDDEN,
            )

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


class MonthlyFoodCostView(APIView):
    """Get monthly food cost breakdown per house (admin only)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        """Get monthly food cost report for a specific month."""
        # Only staff can access this report
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can access food cost reports."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Validate query params
        year = request.query_params.get("year")
        month = request.query_params.get("month")

        if not year or not month:
            return Response(
                {"detail": "Please provide 'year' and 'month' query parameters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except ValueError:
            return Response(
                {"detail": "Year and month must be integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MonthlyFoodCostSerializer(data={"year": year, "month": month})
        serializer.is_valid(raise_exception=True)

        from calendar import monthrange
        from decimal import Decimal

        from apps.houses.models import House

        # Food prices (same as in FoodTicketCreateSerializer)
        price_adult_meat = Decimal("37.00")
        price_adult_veg = Decimal("26.00")
        price_child = Decimal("18.00")

        first_day = date(year, month, 1)
        _, last_day_num = monthrange(year, month)
        last_day = date(year, month, last_day_num)

        # Get all houses
        houses = House.objects.prefetch_related("inhabitants")
        house_costs = []
        total_cost = Decimal("0.00")

        # Collect Mon-Thu dates in the month where the deadline has already passed
        billing_dates: list[date] = []
        current = first_day
        while current <= last_day:
            if current.weekday() <= 3 and is_after_deadline(current):
                billing_dates.append(current)
            current += timedelta(days=1)

        # Safety net: materialize any missing registrations before computing costs.
        # The periodic Huey task should have already done this, but if it missed any
        # dates (e.g. downtime), this ensures billing never falls back to mutable
        # preferences which could retroactively change costs.
        from .tasks import _materialize_for_houses

        _materialize_for_houses(billing_dates)

        for house in houses:
            house_total = Decimal("0.00")
            registration_count = 0
            adult_portions = 0
            child_portions = 0

            # Deduplicate: latest registration (active OR inactive) per date per house.
            # We track inactive registrations to avoid double-billing via preference fallback
            # when the user explicitly opted out (is_active=False).
            regs_by_date: dict[date, MealRegistration] = {}
            for reg in MealRegistration.objects.filter(
                user__house=house,
                date__gte=first_day,
                date__lte=last_day,
            ).order_by("date", "id"):
                regs_by_date[reg.date] = reg  # latest wins (ascending id order)

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
                    (price_adult_meat * meat) + (price_adult_veg * veg) + (price_child * children)
                )
                house_total += cost
                registration_count += 1
                adult_portions += meat + veg
                child_portions += children

            house_costs.append(
                {
                    "house_id": house.id,
                    "house_name": house.name,
                    "total_cost": house_total,
                    "registration_count": registration_count,
                    "ticket_count": 0,
                    "adult_portions": adult_portions,
                    "child_portions": child_portions,
                }
            )
            total_cost += house_total

        # Sort by house name
        house_costs.sort(key=lambda x: x["house_name"])

        # Get month name
        month_names = [
            "",
            "Januar",
            "Februar",
            "Marts",
            "April",
            "Maj",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "December",
        ]

        result = {
            "year": year,
            "month": month,
            "month_name": month_names[month],
            "total_cost": total_cost,
            "houses": house_costs,
        }

        return Response(MonthlyFoodCostReportSerializer(result).data)


# Drive Menu Views


class DriveMenuView(APIView):
    """
    Get menus from Google Drive.

    GET: Returns the current week's menu (or specified week)
    POST: Force refresh from Google Drive (admin only)
    """

    permission_classes = [permissions.IsAuthenticated]

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
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can force refresh menus."},
                status=status.HTTP_403_FORBIDDEN,
            )

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

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        """Refresh all available menus from Drive (runs in background)."""
        if not request.user.is_staff:
            return Response(
                {"detail": "Only administrators can refresh all menus."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from apps.notifications.tasks import refresh_all_drive_menus_task

        refresh_all_drive_menus_task()

        return Response(
            {"detail": "Menu refresh started in background."},
            status=status.HTTP_202_ACCEPTED,
        )
