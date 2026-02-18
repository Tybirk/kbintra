"""
URL configuration for events endpoints.
"""

from django.urls import path

from .views import (
    EventAttendeesView,
    EventCancelView,
    EventDetailView,
    EventFilesView,
    EventHouseholdView,
    EventICalView,
    EventListCreateView,
    EventRsvpView,
    UpcomingEventsView,
)

urlpatterns = [
    path("", EventListCreateView.as_view(), name="event-list-create"),
    path("upcoming/", UpcomingEventsView.as_view(), name="event-upcoming"),
    path("<int:pk>/", EventDetailView.as_view(), name="event-detail"),
    path("<int:pk>/rsvp/", EventRsvpView.as_view(), name="event-rsvp"),
    path("<int:pk>/attendees/", EventAttendeesView.as_view(), name="event-attendees"),
    path("<int:pk>/household/", EventHouseholdView.as_view(), name="event-household"),
    path("<int:pk>/ical/", EventICalView.as_view(), name="event-ical"),
    path("<int:pk>/files/", EventFilesView.as_view(), name="event-files"),
    path("<int:pk>/cancel/", EventCancelView.as_view(), name="event-cancel"),
]
