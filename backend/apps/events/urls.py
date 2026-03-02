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
    path("<slug:slug>/", EventDetailView.as_view(), name="event-detail"),
    path("<slug:slug>/rsvp/", EventRsvpView.as_view(), name="event-rsvp"),
    path("<slug:slug>/attendees/", EventAttendeesView.as_view(), name="event-attendees"),
    path("<slug:slug>/household/", EventHouseholdView.as_view(), name="event-household"),
    path("<slug:slug>/ical/", EventICalView.as_view(), name="event-ical"),
    path("<slug:slug>/files/", EventFilesView.as_view(), name="event-files"),
    path("<slug:slug>/cancel/", EventCancelView.as_view(), name="event-cancel"),
]
