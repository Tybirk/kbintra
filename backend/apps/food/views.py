"""
Views for Food app.
"""

from datetime import date, timedelta
from typing import Any

from django.db.models import Q, QuerySet, Sum
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    DailyMenu,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamWish,
    FoodTicket,
    MealPreference,
    MealRegistration,
    MealType,
    MenuTemplate,
    SwapRequestStatus,
    TeamSwapRequest,
    WeeklyMenu,
)
from .serializers import (
    ApplyDefaultsSerializer,
    CreateSwapRequestSerializer,
    DailyMenuUpdateSerializer,
    DefaultCookingDaysSerializer,
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
    MenuTemplateSerializer,
    MonthlyFoodCostReportSerializer,
    MonthlyFoodCostSerializer,
    RespondSwapRequestSerializer,
    TeamGenerationResultSerializer,
    TeamSwapRequestSerializer,
    WeeklyMenuCreateSerializer,
    WeeklyMenuSerializer,
)
from .services.team_generator import TeamGenerator


def get_week_start(d: date) -> date:
    """Get the Monday of the week containing the given date."""
    return d - timedelta(days=d.weekday())


# Menu Template Views
class MenuTemplateListCreateView(generics.ListCreateAPIView):
    """List all menu templates or create a new one."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MenuTemplateSerializer
    queryset = MenuTemplate.objects.all()


class MenuTemplateDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Get, update, or delete a menu template."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MenuTemplateSerializer
    queryset = MenuTemplate.objects.all()


# Weekly Menu Views
class WeeklyMenuListCreateView(generics.ListCreateAPIView):
    """List weekly menus or create a new one."""

    permission_classes = [permissions.IsAuthenticated]
    queryset = WeeklyMenu.objects.prefetch_related("daily_menus__template").select_related(
        "created_by"
    )

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return WeeklyMenuCreateSerializer
        return WeeklyMenuSerializer


class WeeklyMenuDetailView(generics.RetrieveAPIView):
    """Get a specific weekly menu."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WeeklyMenuSerializer
    queryset = WeeklyMenu.objects.prefetch_related("daily_menus__template").select_related(
        "created_by"
    )


class CurrentWeekMenuView(APIView):
    """Get the current week's menu."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        today = timezone.now().date()
        week_start = get_week_start(today)

        try:
            menu = (
                WeeklyMenu.objects.prefetch_related("daily_menus__template")
                .select_related("created_by")
                .get(week_start_date=week_start)
            )
            serializer = WeeklyMenuSerializer(menu, context={"request": request})
            return Response(serializer.data)
        except WeeklyMenu.DoesNotExist:
            return Response(
                {"detail": "No menu available for this week."},
                status=status.HTTP_404_NOT_FOUND,
            )


class DailyMenuUpdateView(generics.UpdateAPIView):
    """Update a daily menu."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DailyMenuUpdateSerializer
    queryset = DailyMenu.objects.select_related("template")


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
        """Get registration statistics for a specific date."""
        registrations = MealRegistration.objects.filter(
            date=target_date,
            is_active=True,
        )

        # Aggregate by category
        takeaway = registrations.filter(dining_option="take_away").aggregate(
            adults=Sum("adults_count"),
            children=Sum("children_count"),
        )
        eat_in_1730 = registrations.filter(
            dining_option="eat_in",
            seating_time="17:30",
        ).aggregate(
            adults=Sum("adults_count"),
            children=Sum("children_count"),
        )
        eat_in_1830 = registrations.filter(
            dining_option="eat_in",
            seating_time="18:30",
        ).aggregate(
            adults=Sum("adults_count"),
            children=Sum("children_count"),
        )
        total = registrations.aggregate(
            adults=Sum("adults_count"),
            children=Sum("children_count"),
        )

        return {
            "date": target_date.isoformat(),
            "takeaway": {
                "adults": takeaway["adults"] or 0,
                "children": takeaway["children"] or 0,
            },
            "eat_in_1730": {
                "adults": eat_in_1730["adults"] or 0,
                "children": eat_in_1730["children"] or 0,
            },
            "eat_in_1830": {
                "adults": eat_in_1830["adults"] or 0,
                "children": eat_in_1830["children"] or 0,
            },
            "total": {
                "adults": total["adults"] or 0,
                "children": total["children"] or 0,
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
    """List or create meal registrations for the current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return MealRegistrationCreateUpdateSerializer
        return MealRegistrationSerializer

    def get_queryset(self) -> QuerySet[MealRegistration]:
        queryset = MealRegistration.objects.filter(user=self.request.user)

        # Filter by week if week_start param provided
        week_start = self.request.query_params.get("week_start")
        if week_start:
            try:
                start_date = date.fromisoformat(week_start)
                end_date = start_date + timedelta(days=6)
                queryset = queryset.filter(date__gte=start_date, date__lte=end_date)
            except ValueError:
                pass

        return queryset


class MealRegistrationDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Get, update, or delete a meal registration."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return MealRegistrationCreateUpdateSerializer
        return MealRegistrationSerializer

    def get_queryset(self) -> QuerySet[MealRegistration]:
        return MealRegistration.objects.filter(user=self.request.user)


class ApplyDefaultsView(APIView):
    """Apply default preferences to a week's registrations.

    If user has preferences set, use those.
    Otherwise, use sensible house-based defaults:
    - All house inhabitants eat every day
    - 17:30 seating time (eat in)
    - Meat on Wednesdays
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = ApplyDefaultsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        week_start = serializer.validated_data["week_start_date"]
        preferences = MealPreference.objects.filter(user=request.user)
        user = request.user

        # Get house info for defaults
        house = user.house
        house_inhabitant_count = house.inhabitants.count() if house else 1

        created_count = 0

        if preferences.exists():
            # Use user's preferences
            for pref in preferences:
                reg_date = week_start + timedelta(days=pref.day_of_week)

                # Skip if date is in the past
                if reg_date < timezone.now().date():
                    continue

                # Create or update registration (always house-based)
                registration, created = MealRegistration.objects.update_or_create(
                    user=user,
                    date=reg_date,
                    defaults={
                        "house": house,
                        "adults_count": pref.adults_count,
                        "children_count": pref.children_count,
                        "meal_type": MealType.MEAT if pref.prefers_meat else MealType.VEGETARIAN,
                        "dining_option": pref.dining_option,
                        "seating_time": pref.seating_time,
                        "is_active": True,
                    },
                )
                if created:
                    created_count += 1
        else:
            # Use sensible house-based defaults for all days (Mon-Thu)
            for day in range(4):  # 0=Mon, 1=Tue, 2=Wed, 3=Thu
                reg_date = week_start + timedelta(days=day)

                # Skip if date is in the past
                if reg_date < timezone.now().date():
                    continue

                is_wednesday = day == 2

                # Create or update registration with defaults
                registration, created = MealRegistration.objects.update_or_create(
                    user=user,
                    date=reg_date,
                    defaults={
                        "house": house,
                        "adults_count": house_inhabitant_count,
                        "children_count": 0,
                        "meal_type": MealType.MEAT if is_wednesday else MealType.MEAT,
                        "dining_option": "eat_in",
                        "seating_time": "17:30",
                        "is_active": True,
                    },
                )
                if created:
                    created_count += 1

        return Response(
            {"detail": f"Applied defaults. {created_count} new registrations created."},
            status=status.HTTP_200_OK,
        )


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
        return super().destroy(request, *args, **kwargs)


class ClaimTicketView(APIView):
    """Claim a food ticket."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        try:
            ticket = FoodTicket.objects.get(pk=pk)
        except FoodTicket.DoesNotExist:
            return Response(
                {"detail": "Ticket not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if ticket.owner == request.user:
            return Response(
                {"detail": "You cannot claim your own ticket."},
                status=status.HTTP_400_BAD_REQUEST,
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

        from apps.notifications.services import notify_ticket_claimed

        ticket.is_available = False
        ticket.claimed_by = request.user
        ticket.claimed_at = timezone.now()
        ticket.save()

        # Notify the owner that their ticket was claimed
        notify_ticket_claimed(
            owner=ticket.owner,
            claimer=request.user,
            ticket_date=ticket.date.strftime("%A, %b %d"),
        )

        serializer = FoodTicketSerializer(ticket, context={"request": request})
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
            try:
                queryset = queryset.filter(date__gte=date.fromisoformat(from_date))
            except ValueError:
                pass

        if to_date:
            try:
                queryset = queryset.filter(date__lte=date.fromisoformat(to_date))
            except ValueError:
                pass

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

        # Accept: perform the swap
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

        # Get all claimed tickets for this month
        from calendar import monthrange
        from decimal import Decimal

        from apps.houses.models import House

        first_day = date(year, month, 1)
        _, last_day_num = monthrange(year, month)
        last_day = date(year, month, last_day_num)

        # Get all houses
        houses = House.objects.all()
        house_costs = []
        total_cost = Decimal("0.00")

        for house in houses:
            # Find claimed tickets where the OWNER belongs to this house
            # The owner pays for the meal, not the person who claims the ticket
            claimed_tickets = FoodTicket.objects.filter(
                owner__house=house,
                date__gte=first_day,
                date__lte=last_day,
                is_available=False,
            )

            house_total = Decimal("0.00")
            ticket_count = 0
            adult_portions = 0
            child_portions = 0

            for ticket in claimed_tickets:
                if ticket.price:
                    house_total += ticket.price
                ticket_count += 1
                adult_portions += ticket.adults_count
                child_portions += ticket.children_count

            house_costs.append(
                {
                    "house_id": house.id,
                    "house_name": house.name,
                    "total_cost": house_total,
                    "ticket_count": ticket_count,
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
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
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
