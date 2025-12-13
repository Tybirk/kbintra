"""
URL configuration for calendar endpoints.
"""

from django.urls import path

from .views import EventDetailView, EventListCreateView, UpcomingEventsView

urlpatterns = [
    path("events/", EventListCreateView.as_view(), name="event-list-create"),
    path("events/upcoming/", UpcomingEventsView.as_view(), name="event-upcoming"),
    path("events/<int:pk>/", EventDetailView.as_view(), name="event-detail"),
]
