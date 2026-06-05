"""
URL configuration for food endpoints.
"""

from django.urls import path

from .views import (
    AcceptSwapBroadcastView,
    ActiveCycleView,
    ClaimTicketView,
    ClosedFoodDayDeleteView,
    ClosedFoodDayListCreateView,
    CycleWishesListView,
    DailyRegistrationStatsView,
    DefaultCookingDaysView,
    DriveMenuRefreshAllView,
    DriveMenuView,
    FavourListView,
    FavourSettleView,
    FoodRosterDetailView,
    FoodRosterListView,
    FoodTeamCycleDetailView,
    FoodTeamCycleListCreateView,
    FoodTeamDetailView,
    FoodTeamListView,
    FoodTicketDetailView,
    FoodTicketListCreateView,
    GenerateTeamsView,
    MealPreferenceDetailView,
    MealPreferenceListCreateView,
    MealRegistrationDetailView,
    MealRegistrationListCreateView,
    MonthlyFoodCostView,
    MyFoodProfileView,
    MyMonthlyExpensesView,
    MyTeamsView,
    MyTicketsView,
    MyWishView,
    NotifyLeftoversReadyView,
    NotifyTakeawayReadyView,
    ReleaseTicketView,
    RespondSwapRequestView,
    SwapBroadcastDetailView,
    SwapBroadcastListCreateView,
    SwapRequestDetailView,
    SwapRequestListCreateView,
    TakeoverView,
    TodayLeftoversView,
    TodayTeamActionBoxView,
    TodayTeamRecipesView,
    WeekRecipesView,
)

app_name = "food"

urlpatterns = [
    # Preferences
    path("preferences/", MealPreferenceListCreateView.as_view(), name="preference-list"),
    path("preferences/<int:pk>/", MealPreferenceDetailView.as_view(), name="preference-detail"),
    # Registrations
    path("registrations/", MealRegistrationListCreateView.as_view(), name="registration-list"),
    path(
        "registrations/<int:pk>/", MealRegistrationDetailView.as_view(), name="registration-detail"
    ),
    path("registrations/stats/", DailyRegistrationStatsView.as_view(), name="registration-stats"),
    # Tickets
    path("tickets/", FoodTicketListCreateView.as_view(), name="ticket-list"),
    path("tickets/my/", MyTicketsView.as_view(), name="my-tickets"),
    path("tickets/<int:pk>/", FoodTicketDetailView.as_view(), name="ticket-detail"),
    path("tickets/<int:pk>/claim/", ClaimTicketView.as_view(), name="ticket-claim"),
    path("tickets/<int:pk>/release/", ReleaseTicketView.as_view(), name="ticket-release"),
    # Teams
    path("teams/", FoodTeamListView.as_view(), name="team-list"),
    path("teams/my/", MyTeamsView.as_view(), name="my-teams"),
    path("teams/today/", TodayTeamActionBoxView.as_view(), name="team-today"),
    path("teams/today/recipes/", TodayTeamRecipesView.as_view(), name="team-today-recipes"),
    path("recipes/week/", WeekRecipesView.as_view(), name="recipes-week"),
    path("leftovers/today/", TodayLeftoversView.as_view(), name="leftovers-today"),
    path("teams/takeover/", TakeoverView.as_view(), name="team-takeover"),
    path("teams/<int:pk>/", FoodTeamDetailView.as_view(), name="team-detail"),
    path(
        "teams/<int:pk>/notify-takeaway/",
        NotifyTakeawayReadyView.as_view(),
        name="team-notify-takeaway",
    ),
    path(
        "teams/<int:pk>/notify-leftovers/",
        NotifyLeftoversReadyView.as_view(),
        name="team-notify-leftovers",
    ),
    # Swap Requests (1:1)
    path("swap-requests/", SwapRequestListCreateView.as_view(), name="swap-request-list"),
    path("swap-requests/<int:pk>/", SwapRequestDetailView.as_view(), name="swap-request-detail"),
    path(
        "swap-requests/<int:pk>/respond/",
        RespondSwapRequestView.as_view(),
        name="swap-request-respond",
    ),
    # Broadcast swaps ("bytteanmodning")
    path("swap-broadcasts/", SwapBroadcastListCreateView.as_view(), name="swap-broadcast-list"),
    path(
        "swap-broadcasts/<int:pk>/",
        SwapBroadcastDetailView.as_view(),
        name="swap-broadcast-detail",
    ),
    path(
        "swap-broadcasts/<int:pk>/accept/",
        AcceptSwapBroadcastView.as_view(),
        name="swap-broadcast-accept",
    ),
    # Favours ("you owe me one")
    path("favours/", FavourListView.as_view(), name="favour-list"),
    path("favours/<int:pk>/settle/", FavourSettleView.as_view(), name="favour-settle"),
    # Personal food-team profile (self-service)
    path("my-food-profile/", MyFoodProfileView.as_view(), name="my-food-profile"),
    # Admin roster
    path("admin/roster/", FoodRosterListView.as_view(), name="food-roster"),
    path("admin/roster/<int:pk>/", FoodRosterDetailView.as_view(), name="food-roster-detail"),
    # Cycles
    path("cycles/", FoodTeamCycleListCreateView.as_view(), name="cycle-list"),
    path("cycles/active/", ActiveCycleView.as_view(), name="cycle-active"),
    path("cycles/<int:pk>/", FoodTeamCycleDetailView.as_view(), name="cycle-detail"),
    path("cycles/<int:cycle_id>/wishes/", CycleWishesListView.as_view(), name="cycle-wishes"),
    path("cycles/<int:cycle_id>/my-wish/", MyWishView.as_view(), name="my-wish"),
    # Team Generation
    path("generate-teams/", GenerateTeamsView.as_view(), name="generate-teams"),
    # User Preferences
    path(
        "default-cooking-days/",
        DefaultCookingDaysView.as_view(),
        name="default-cooking-days",
    ),
    # Expenses (user-facing)
    path("my-expenses/", MyMonthlyExpensesView.as_view(), name="my-expenses"),
    # Admin Reports
    path(
        "admin/monthly-cost/",
        MonthlyFoodCostView.as_view(),
        name="monthly-food-cost",
    ),
    # Drive Menu (from Google Drive)
    path("drive-menu/", DriveMenuView.as_view(), name="drive-menu"),
    path(
        "drive-menu/refresh-all/", DriveMenuRefreshAllView.as_view(), name="drive-menu-refresh-all"
    ),
    # Closed Food Days
    path("closed-days/", ClosedFoodDayListCreateView.as_view(), name="closed-day-list"),
    path("closed-days/<int:pk>/", ClosedFoodDayDeleteView.as_view(), name="closed-day-detail"),
]
