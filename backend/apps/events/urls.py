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
    path("<str:slug>/", EventDetailView.as_view(), name="event-detail"),
    path("<str:slug>/rsvp/", EventRsvpView.as_view(), name="event-rsvp"),
    path("<str:slug>/attendees/", EventAttendeesView.as_view(), name="event-attendees"),
    path("<str:slug>/household/", EventHouseholdView.as_view(), name="event-household"),
    path("<str:slug>/ical/", EventICalView.as_view(), name="event-ical"),
    path("<str:slug>/files/", EventFilesView.as_view(), name="event-files"),
    path("<str:slug>/cancel/", EventCancelView.as_view(), name="event-cancel"),
]
