"""
Tests for the Events app.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.events.models import Event, EventAttendance


@pytest.fixture
def event(db, user):
    """Create a test community event."""
    now = timezone.now()
    return Event.objects.create(
        title="Test Event",
        description="A test event description",
        created_by=user,
        visibility=Event.Visibility.COMMUNITY,
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
        visibility=Event.Visibility.COMMUNITY,
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
        visibility=Event.Visibility.COMMUNITY,
        start_datetime=now + timedelta(days=30),
        end_datetime=now + timedelta(days=30, hours=3),
    )


@pytest.fixture
def rsvp_event(db, user):
    """Create an event with RSVP enabled."""
    now = timezone.now()
    return Event.objects.create(
        title="RSVP Event",
        description="Event with RSVP",
        created_by=user,
        visibility=Event.Visibility.COMMUNITY,
        start_datetime=now + timedelta(days=5),
        end_datetime=now + timedelta(days=5, hours=2),
        rsvp_enabled=True,
        rsvp_deadline=now + timedelta(days=4),
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestEventModel:
    """Tests for the Event model."""

    def test_event_str(self, event):
        assert "Test Event" in str(event)

    def test_event_ordering(self, event, past_event, future_event):
        events = list(Event.objects.all())
        assert events[0] == past_event
        assert events[1] == event
        assert events[2] == future_event

    def test_resolved_location_room_and_text(self, db, user):
        from apps.bookings.models import Room

        room = Room.objects.create(name="Festsalen")
        now = timezone.now()
        evt = Event.objects.create(
            title="Fest",
            created_by=user,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=3),
            room=room,
            location="1. sal",
        )
        assert evt.resolved_location == "Festsalen, 1. sal"


# =============================================================================
# API Tests
# =============================================================================


class TestEventAPI:
    """Tests for the Event API endpoints."""

    def test_list_events_unauthenticated(self, api_client):
        response = api_client.get("/api/events/")
        assert response.status_code == 401

    def test_list_events(self, authenticated_client, event):
        response = authenticated_client.get("/api/events/")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Test Event"

    def test_list_events_with_date_filter(self, authenticated_client, event, past_event):
        now = timezone.now()
        response = authenticated_client.get(f"/api/events/?start={now.isoformat()}")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert any(e["title"] == "Test Event" for e in results)

    def test_list_events_visibility_filter(self, authenticated_client, event, db, user):
        now = timezone.now()
        Event.objects.create(
            title="Private Booking",
            created_by=user,
            visibility=Event.Visibility.PRIVATE,
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=1),
        )
        response = authenticated_client.get("/api/events/?visibility=community")
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert all(e["visibility"] == "community" for e in results)

    def test_create_event(self, authenticated_client):
        now = timezone.now()
        response = authenticated_client.post(
            "/api/events/",
            {
                "title": "New Event",
                "description": "A new event",
                "visibility": "community",
                "start_datetime": (now + timedelta(days=5)).isoformat(),
                "end_datetime": (now + timedelta(days=5, hours=2)).isoformat(),
                "location": "Klubhuset",
            },
            format="json",
        )
        assert response.status_code == 201
        assert Event.objects.filter(title="New Event").exists()

    def test_create_private_event_with_room(self, authenticated_client, db):
        from apps.bookings.models import Room

        room = Room.objects.create(name="Test Room")
        now = timezone.now()
        response = authenticated_client.post(
            "/api/events/",
            {
                "title": "Room Booking",
                "visibility": "private",
                "room_id": room.id,
                "start_datetime": (now + timedelta(days=1)).isoformat(),
                "end_datetime": (now + timedelta(days=1, hours=2)).isoformat(),
            },
            format="json",
        )
        assert response.status_code == 201
        evt = Event.objects.get(title="Room Booking")
        assert evt.room_id == room.id
        assert evt.visibility == "private"

    def test_get_event(self, authenticated_client, event):
        response = authenticated_client.get(f"/api/events/{event.id}/")
        assert response.status_code == 200
        assert response.json()["title"] == "Test Event"

    def test_update_own_event(self, authenticated_client, event):
        response = authenticated_client.patch(
            f"/api/events/{event.id}/",
            {"title": "Updated Event"},
            format="json",
        )
        assert response.status_code == 200
        event.refresh_from_db()
        assert event.title == "Updated Event"

    def test_cannot_update_others_event(self, api_client, second_user, event):
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/events/{event.id}/",
            {"title": "Hacked Title"},
            format="json",
        )
        assert response.status_code == 403

    def test_delete_own_event(self, authenticated_client, event):
        response = authenticated_client.delete(f"/api/events/{event.id}/")
        assert response.status_code == 204
        assert not Event.objects.filter(id=event.id).exists()

    def test_cannot_delete_others_event(self, api_client, second_user, event):
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/events/{event.id}/")
        assert response.status_code == 403

    def test_room_overlap_rejected(self, authenticated_client, db):
        from apps.bookings.models import Room

        room = Room.objects.create(name="Overlap Room")
        now = timezone.now()
        start = now + timedelta(days=3)
        end = start + timedelta(hours=2)
        # Create first event
        authenticated_client.post(
            "/api/events/",
            {
                "title": "First",
                "visibility": "private",
                "room_id": room.id,
                "start_datetime": start.isoformat(),
                "end_datetime": end.isoformat(),
            },
            format="json",
        )
        # Second overlapping event should fail
        response = authenticated_client.post(
            "/api/events/",
            {
                "title": "Second",
                "visibility": "private",
                "room_id": room.id,
                "start_datetime": start.isoformat(),
                "end_datetime": end.isoformat(),
            },
            format="json",
        )
        assert response.status_code == 400


class TestUpcomingEventsAPI:
    def test_upcoming_events(self, authenticated_client, event, past_event, future_event):
        response = authenticated_client.get("/api/events/upcoming/")
        assert response.status_code == 200
        data = response.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        titles = [e["title"] for e in results]
        assert "Past Event" not in titles
        assert "Test Event" in titles
        assert "Future Event" in titles


class TestRsvpAPI:
    def test_submit_rsvp(self, authenticated_client, rsvp_event, user):
        response = authenticated_client.patch(
            f"/api/events/{rsvp_event.id}/rsvp/",
            {
                "attendances": [
                    {"user_id": user.id, "status": "attending"},
                ]
            },
            format="json",
        )
        assert response.status_code == 200
        assert EventAttendance.objects.filter(
            event=rsvp_event, user=user, status="attending"
        ).exists()

    def test_rsvp_disabled_event(self, authenticated_client, event, user):
        response = authenticated_client.patch(
            f"/api/events/{event.id}/rsvp/",
            {"attendances": [{"user_id": user.id, "status": "attending"}]},
            format="json",
        )
        assert response.status_code == 400

    def test_get_attendees(self, authenticated_client, rsvp_event, user):
        EventAttendance.objects.create(
            event=rsvp_event,
            user=user,
            responded_by=user,
            status=EventAttendance.Status.ATTENDING,
        )
        response = authenticated_client.get(f"/api/events/{rsvp_event.id}/attendees/")
        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_ical_download(self, authenticated_client, event):
        response = authenticated_client.get(f"/api/events/{event.id}/ical/")
        assert response.status_code == 200
        assert response["Content-Type"] == "text/calendar; charset=utf-8"
        assert b"BEGIN:VCALENDAR" in response.content
