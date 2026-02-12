"""
Tests for the Calendar app.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.calendar_app.models import Event


@pytest.fixture
def event(db, user):
    """Create a test event."""
    now = timezone.now()
    return Event.objects.create(
        title="Test Event",
        description="A test event description",
        created_by=user,
        start_datetime=now + timedelta(days=1),
        end_datetime=now + timedelta(days=1, hours=2),
        location="Fælleshuset",
    )


@pytest.fixture
def past_event(db, user):
    """Create a past event."""
    now = timezone.now()
    return Event.objects.create(
        title="Past Event",
        description="An old event",
        created_by=user,
        start_datetime=now - timedelta(days=7),
        end_datetime=now - timedelta(days=7, hours=-2),
    )


@pytest.fixture
def future_event(db, user):
    """Create a future event."""
    now = timezone.now()
    return Event.objects.create(
        title="Future Event",
        description="A future event",
        created_by=user,
        start_datetime=now + timedelta(days=30),
        end_datetime=now + timedelta(days=30, hours=3),
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestEventModel:
    """Tests for the Event model."""

    def test_event_str(self, event):
        """Test string representation of event."""
        assert "Test Event" in str(event)

    def test_event_ordering(self, event, past_event, future_event):
        """Test that events are ordered by start_datetime."""
        events = list(Event.objects.all())
        assert events[0] == past_event
        assert events[1] == event
        assert events[2] == future_event


# =============================================================================
# API Tests
# =============================================================================


class TestEventAPI:
    """Tests for the Event API endpoints."""

    def test_list_events_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list events."""
        response = api_client.get("/api/calendar/events/")
        assert response.status_code == 401

    def test_list_events(self, authenticated_client, event):
        """Test listing events."""
        response = authenticated_client.get("/api/calendar/events/")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Test Event"

    def test_list_events_with_date_filter(self, authenticated_client, event, past_event):
        """Test listing events with date filter."""
        now = timezone.now()
        response = authenticated_client.get(f"/api/calendar/events/?start={now.isoformat()}")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        # Events are filtered by start_datetime >= start
        # So only the future event should be included
        assert any(e["title"] == "Test Event" for e in results)

    def test_create_event(self, authenticated_client):
        """Test creating an event."""
        now = timezone.now()
        response = authenticated_client.post(
            "/api/calendar/events/",
            {
                "title": "New Event",
                "description": "A new event",
                "start_datetime": (now + timedelta(days=5)).isoformat(),
                "end_datetime": (now + timedelta(days=5, hours=2)).isoformat(),
                "location": "Klubhuset",
            },
            format="json",
        )
        assert response.status_code == 201
        assert Event.objects.filter(title="New Event").exists()

    def test_get_event(self, authenticated_client, event):
        """Test getting a single event."""
        response = authenticated_client.get(f"/api/calendar/events/{event.id}/")
        assert response.status_code == 200
        assert response.json()["title"] == "Test Event"

    def test_update_own_event(self, authenticated_client, event):
        """Test updating own event."""
        response = authenticated_client.patch(
            f"/api/calendar/events/{event.id}/",
            {"title": "Updated Event"},
            format="json",
        )
        assert response.status_code == 200
        event.refresh_from_db()
        assert event.title == "Updated Event"

    def test_cannot_update_others_event(self, api_client, second_user, event):
        """Test that users cannot update others' events."""
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/calendar/events/{event.id}/",
            {"title": "Hacked Title"},
            format="json",
        )
        assert response.status_code == 403

    def test_delete_own_event(self, authenticated_client, event):
        """Test deleting own event."""
        response = authenticated_client.delete(f"/api/calendar/events/{event.id}/")
        assert response.status_code == 204
        assert not Event.objects.filter(id=event.id).exists()

    def test_cannot_delete_others_event(self, api_client, second_user, event):
        """Test that users cannot delete others' events."""
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/calendar/events/{event.id}/")
        assert response.status_code == 403


class TestUpcomingEventsAPI:
    """Tests for the Upcoming Events API endpoint."""

    def test_upcoming_events(self, authenticated_client, event, past_event, future_event):
        """Test getting upcoming events."""
        response = authenticated_client.get("/api/calendar/events/upcoming/")
        assert response.status_code == 200

        data = response.json()
        # Handle both paginated and non-paginated responses
        results = data.get("results", data) if isinstance(data, dict) else data
        # Should only include future events
        titles = [e["title"] for e in results]
        assert "Past Event" not in titles
        assert "Test Event" in titles
        assert "Future Event" in titles
