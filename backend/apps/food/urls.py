"""
URL configuration for food endpoints.
"""

from django.urls import path

app_name = "food"

from .views import (
    ActiveCycleView,
    ApplyDefaultsView,
    ClaimTicketView,
    CurrentWeekMenuView,
    CycleWishesListView,
    DailyMenuUpdateView,
    DailyRegistrationStatsView,
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
    MenuTemplateDetailView,
    MenuTemplateListCreateView,
    MyTeamsView,
    MyTicketsView,
    MyWishView,
    ReleaseTicketView,
    RespondSwapRequestView,
    SwapRequestDetailView,
    SwapRequestListCreateView,
    WeeklyMenuDetailView,
    WeeklyMenuListCreateView,
)

urlpatterns = [
    # Menu Templates
    path("templates/", MenuTemplateListCreateView.as_view(), name="template-list"),
    path("templates/<int:pk>/", MenuTemplateDetailView.as_view(), name="template-detail"),
    # Weekly Menus
    path("menus/", WeeklyMenuListCreateView.as_view(), name="menu-list"),
    path("menus/current/", CurrentWeekMenuView.as_view(), name="menu-current"),
    path("menus/<int:pk>/", WeeklyMenuDetailView.as_view(), name="menu-detail"),
    path("menus/daily/<int:pk>/", DailyMenuUpdateView.as_view(), name="daily-menu-update"),
    # Preferences
    path("preferences/", MealPreferenceListCreateView.as_view(), name="preference-list"),
    path("preferences/<int:pk>/", MealPreferenceDetailView.as_view(), name="preference-detail"),
    # Registrations
    path("registrations/", MealRegistrationListCreateView.as_view(), name="registration-list"),
    path(
        "registrations/<int:pk>/", MealRegistrationDetailView.as_view(), name="registration-detail"
    ),
    path("registrations/apply-defaults/", ApplyDefaultsView.as_view(), name="apply-defaults"),
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
    path("teams/<int:pk>/", FoodTeamDetailView.as_view(), name="team-detail"),
    # Swap Requests
    path("swap-requests/", SwapRequestListCreateView.as_view(), name="swap-request-list"),
    path("swap-requests/<int:pk>/", SwapRequestDetailView.as_view(), name="swap-request-detail"),
    path(
        "swap-requests/<int:pk>/respond/",
        RespondSwapRequestView.as_view(),
        name="swap-request-respond",
    ),
    # Cycles
    path("cycles/", FoodTeamCycleListCreateView.as_view(), name="cycle-list"),
    path("cycles/active/", ActiveCycleView.as_view(), name="cycle-active"),
    path("cycles/<int:pk>/", FoodTeamCycleDetailView.as_view(), name="cycle-detail"),
    path("cycles/<int:cycle_id>/wishes/", CycleWishesListView.as_view(), name="cycle-wishes"),
    path("cycles/<int:cycle_id>/my-wish/", MyWishView.as_view(), name="my-wish"),
    # Team Generation
    path("generate-teams/", GenerateTeamsView.as_view(), name="generate-teams"),
]
