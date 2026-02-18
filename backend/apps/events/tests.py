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

    def test_create_multi_room_booking(self, authenticated_client, db):
        """Creating with room_ids creates one Event per room and returns secondary_event_ids."""
        from apps.bookings.models import Room

        room1 = Room.objects.create(name="Festsalen")
        room2 = Room.objects.create(name="Klublokalet")
        now = timezone.now()
        response = authenticated_client.post(
            "/api/events/",
            {
                "title": "Multi Room",
                "visibility": "private",
                "room_ids": [room1.id, room2.id],
                "start_datetime": (now + timedelta(days=1)).isoformat(),
                "end_datetime": (now + timedelta(days=1, hours=2)).isoformat(),
            },
            format="json",
        )
        assert response.status_code == 201
        assert Event.objects.filter(title="Multi Room").count() == 2
        data = response.json()
        assert "secondary_event_ids" in data
        assert len(data["secondary_event_ids"]) == 1

    def test_list_mine_filter(self, api_client, db, user, second_user, event):
        """?mine=true returns only the requesting user's events."""
        now = timezone.now()
        Event.objects.create(
            title="Other User Event",
            created_by=second_user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=1),
        )
        api_client.force_authenticate(user=user)
        response = api_client.get("/api/events/?mine=true")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert all(e["created_by"]["id"] == user.id for e in results)

    def test_list_room_filter(self, authenticated_client, db, user):
        """?room=<id> returns only events for that room."""
        from apps.bookings.models import Room

        room = Room.objects.create(name="Filtreringsrum")
        now = timezone.now()
        Event.objects.create(
            title="Room Event",
            created_by=user,
            visibility=Event.Visibility.PRIVATE,
            room=room,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=1),
        )
        Event.objects.create(
            title="No Room Event",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=1),
        )
        response = authenticated_client.get(f"/api/events/?room={room.id}")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Room Event"

    def test_list_subgroup_filter(self, authenticated_client, db, user):
        """?subgroup=<id> returns only events linked to that subgroup."""
        from apps.forum.models import Subgroup

        sg = Subgroup.objects.create(name="Filtrer Gruppe", slug="filtrer-gruppe")
        now = timezone.now()
        Event.objects.create(
            title="Subgroup Event",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            subgroup=sg,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=1),
        )
        Event.objects.create(
            title="No Subgroup Event",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=2),
            end_datetime=now + timedelta(days=2, hours=1),
        )
        response = authenticated_client.get(f"/api/events/?subgroup={sg.id}")
        assert response.status_code == 200
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Subgroup Event"

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


class TestRsvpValidation:
    def test_rsvp_rejected_for_user_in_different_house(self, api_client, db, rsvp_event):
        """User cannot RSVP on behalf of a user in a different house."""
        from apps.houses.models import House
        from apps.users.models import User

        house_a = House.objects.create(name="House A")
        house_b = House.objects.create(name="House B")
        user_a = User.objects.create_user(
            email="a@rsvptest.com",
            password="pass",
            first_name="A",
            last_name="Test",
            house=house_a,
        )
        user_b = User.objects.create_user(
            email="b@rsvptest.com",
            password="pass",
            first_name="B",
            last_name="Test",
            house=house_b,
        )
        api_client.force_authenticate(user=user_a)
        response = api_client.patch(
            f"/api/events/{rsvp_event.id}/rsvp/",
            {"attendances": [{"user_id": user_b.id, "status": "attending"}]},
            format="json",
        )
        assert response.status_code == 403

    def test_rsvp_deadline_enforcement(self, authenticated_client, db, user):
        """RSVP after deadline returns 400."""
        now = timezone.now()
        event = Event.objects.create(
            title="Deadline Event",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=5),
            end_datetime=now + timedelta(days=5, hours=2),
            rsvp_enabled=True,
            rsvp_deadline=now - timedelta(hours=1),
        )
        response = authenticated_client.patch(
            f"/api/events/{event.id}/rsvp/",
            {"attendances": [{"user_id": user.id, "status": "attending"}]},
            format="json",
        )
        assert response.status_code == 400

    def test_rsvp_upsert_updates_existing(self, authenticated_client, rsvp_event, user):
        """Submitting RSVP twice updates the existing record, not creates a duplicate."""
        authenticated_client.patch(
            f"/api/events/{rsvp_event.id}/rsvp/",
            {"attendances": [{"user_id": user.id, "status": "attending"}]},
            format="json",
        )
        authenticated_client.patch(
            f"/api/events/{rsvp_event.id}/rsvp/",
            {"attendances": [{"user_id": user.id, "status": "not_attending"}]},
            format="json",
        )
        attendances = EventAttendance.objects.filter(event=rsvp_event, user=user)
        assert attendances.count() == 1
        assert attendances.first().status == "not_attending"


class TestEventNotifications:
    def test_notify_on_community_event_create(self, api_client, db, second_user, user):
        """Creating a community event enqueues notifications for other users."""
        from apps.notifications.models import Notification

        api_client.force_authenticate(user=user)
        now = timezone.now()
        api_client.post(
            "/api/events/",
            {
                "title": "Fællesarrangement",
                "visibility": "community",
                "start_datetime": (now + timedelta(days=5)).isoformat(),
                "end_datetime": (now + timedelta(days=5, hours=2)).isoformat(),
            },
            format="json",
        )
        # second_user should have received a notification (Huey runs immediately in tests)
        assert Notification.objects.filter(user=second_user).exists()

    def test_no_notify_for_private_event(self, api_client, db, second_user, user):
        """Creating a private event does not notify other users."""
        from apps.notifications.models import Notification

        api_client.force_authenticate(user=user)
        now = timezone.now()
        api_client.post(
            "/api/events/",
            {
                "title": "Privat booking",
                "visibility": "private",
                "start_datetime": (now + timedelta(days=5)).isoformat(),
                "end_datetime": (now + timedelta(days=5, hours=2)).isoformat(),
            },
            format="json",
        )
        assert not Notification.objects.filter(user=second_user).exists()


class TestICalContent:
    def test_ical_contains_event_details(self, authenticated_client, db, user):
        """iCal response includes required fields with correct values."""
        now = timezone.now()
        event = Event.objects.create(
            title="Julefest",
            description="En stor julefest",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=10),
            end_datetime=now + timedelta(days=10, hours=3),
            location="Fælleshuset",
        )
        response = authenticated_client.get(f"/api/events/{event.id}/ical/")
        assert response.status_code == 200
        content = response.content.decode()
        assert "BEGIN:VCALENDAR" in content
        assert "END:VCALENDAR" in content
        assert "SUMMARY:Julefest" in content
        assert "LOCATION:Fælleshuset" in content
        assert f"UID:event-{event.id}@kbintra" in content
        assert "DTSTART:" in content
        assert "DTEND:" in content


class TestEventFilesView:
    def test_auto_folder_created_on_first_upload(self, authenticated_client, db, user):
        """Uploading a file to a subgroup-linked event creates a folder on demand."""
        from io import BytesIO

        from apps.forum.models import Folder, Subgroup

        subgroup = Subgroup.objects.create(name="Files Group", slug="files-group")
        now = timezone.now()
        event = Event.objects.create(
            title="Files Event",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
            subgroup=subgroup,
        )
        assert event.folder is None

        upload = BytesIO(b"hello world")
        upload.name = "test.txt"
        response = authenticated_client.post(
            f"/api/events/{event.id}/files/",
            {"files": upload},
            format="multipart",
        )
        assert response.status_code == 201
        event.refresh_from_db()
        assert event.folder is not None
        assert Folder.objects.filter(id=event.folder_id).exists()


class TestEventReminderLog:
    """Tests for the EventReminderLog model."""

    def test_reminder_log_created(self, db, event):
        """ReminderLog can be created for an event."""
        from apps.events.models import EventReminderLog

        log = EventReminderLog.objects.create(
            event=event,
            reminder_type=EventReminderLog.ReminderType.H24,
            recipients_count=5,
        )
        assert log.id is not None
        assert log.reminder_type == "24h"
        assert log.recipients_count == 5

    def test_reminder_log_unique_per_type(self, db, event):
        """Only one log entry per (event, reminder_type) is allowed."""
        from django.db import IntegrityError

        from apps.events.models import EventReminderLog

        EventReminderLog.objects.create(
            event=event,
            reminder_type=EventReminderLog.ReminderType.H24,
        )
        with pytest.raises(IntegrityError):
            EventReminderLog.objects.create(
                event=event,
                reminder_type=EventReminderLog.ReminderType.H24,
            )

    def test_both_reminder_types_allowed_for_same_event(self, db, event):
        """24h and 1h reminders can coexist for the same event."""
        from apps.events.models import EventReminderLog

        EventReminderLog.objects.create(
            event=event, reminder_type=EventReminderLog.ReminderType.H24
        )
        EventReminderLog.objects.create(event=event, reminder_type=EventReminderLog.ReminderType.H1)
        assert EventReminderLog.objects.filter(event=event).count() == 2

    def test_reminder_log_deleted_with_event(self, db, event):
        """ReminderLog is cascade-deleted when the event is deleted."""
        from apps.events.models import EventReminderLog

        EventReminderLog.objects.create(
            event=event, reminder_type=EventReminderLog.ReminderType.H24
        )
        event_id = event.id
        event.delete()
        assert EventReminderLog.objects.filter(event_id=event_id).count() == 0


class TestSendEventRemindersTask:
    """Tests for the periodic send_event_reminders task."""

    def _make_event(
        self, db, user, start_offset_hours: float, visibility=Event.Visibility.COMMUNITY
    ):
        """Helper to create an event starting offset_hours from now."""
        now = timezone.now()
        start = now + timedelta(hours=start_offset_hours)
        return Event.objects.create(
            title=f"Event in {start_offset_hours}h",
            created_by=user,
            visibility=visibility,
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
        )

    def test_24h_window_event_gets_enqueued(self, db, user):
        """An event 24 hours away triggers the 24h reminder."""
        from apps.events.models import EventReminderLog
        from apps.events.tasks import send_event_reminders

        event = self._make_event(db, user, 24)
        send_event_reminders()
        assert EventReminderLog.objects.filter(
            event=event, reminder_type=EventReminderLog.ReminderType.H24
        ).exists()

    def test_1h_window_event_gets_enqueued(self, db, user):
        """An event 1 hour away triggers the 1h reminder."""
        from apps.events.models import EventReminderLog
        from apps.events.tasks import send_event_reminders

        event = self._make_event(db, user, 1)
        send_event_reminders()
        assert EventReminderLog.objects.filter(
            event=event, reminder_type=EventReminderLog.ReminderType.H1
        ).exists()

    def test_event_outside_window_not_enqueued(self, db, user):
        """Events more than 25h away do not get a 24h reminder."""
        from apps.events.models import EventReminderLog
        from apps.events.tasks import send_event_reminders

        event = self._make_event(db, user, 48)
        send_event_reminders()
        assert not EventReminderLog.objects.filter(event=event).exists()

    def test_already_reminded_event_skipped(self, db, user):
        """An event that already has a 24h log entry is not enqueued again."""
        from apps.events.models import EventReminderLog
        from apps.events.tasks import send_event_reminders

        event = self._make_event(db, user, 24)
        # Pre-create the log entry as if reminder was already sent
        EventReminderLog.objects.create(
            event=event, reminder_type=EventReminderLog.ReminderType.H24, recipients_count=10
        )
        send_event_reminders()
        # Count should still be 1 (no second entry created)
        assert (
            EventReminderLog.objects.filter(
                event=event, reminder_type=EventReminderLog.ReminderType.H24
            ).count()
            == 1
        )

    def test_private_event_not_reminded(self, db, user):
        """Private events (room bookings) do not get reminder notifications."""
        from apps.events.models import EventReminderLog
        from apps.events.tasks import send_event_reminders

        event = self._make_event(db, user, 24, visibility=Event.Visibility.PRIVATE)
        send_event_reminders()
        assert not EventReminderLog.objects.filter(event=event).exists()


class TestNotifyEventReminderService:
    """Tests for the notify_event_reminder notification service."""

    def _make_recipients(self, db, count: int):
        """Create active users to act as notification recipients."""
        from apps.users.models import User

        users = []
        for i in range(count):
            users.append(
                User.objects.create_user(
                    email=f"reminder_user_{i}@example.com",
                    password="pass",
                    first_name=f"User{i}",
                    last_name="Test",
                    is_active=True,
                )
            )
        return users

    def test_reminder_notifies_all_active_users(self, db, user, event):
        """For a plain community event, all active users are notified."""
        from apps.notifications.models import Notification
        from apps.notifications.services import notify_event_reminder

        extra_users = self._make_recipients(db, 3)
        count = notify_event_reminder(event.id, "24h")
        # At least the extra users + the event creator
        assert count >= 3
        # Notifications are created in the DB
        notifs = Notification.objects.filter(notification_type="event_reminder")
        notif_user_ids = set(notifs.values_list("user_id", flat=True))
        for u in extra_users:
            assert u.id in notif_user_ids

    def test_rsvp_event_only_notifies_attending(self, db, user, rsvp_event, second_user):
        """For RSVP-enabled events, only attending users receive reminders."""
        from apps.events.models import EventAttendance
        from apps.notifications.models import Notification
        from apps.notifications.services import notify_event_reminder

        # Mark second_user as attending, creator as not attending
        EventAttendance.objects.create(
            event=rsvp_event,
            responded_by=second_user,
            user=second_user,
            status=EventAttendance.Status.ATTENDING,
        )
        EventAttendance.objects.create(
            event=rsvp_event,
            responded_by=user,
            user=user,
            status=EventAttendance.Status.NOT_ATTENDING,
        )
        count = notify_event_reminder(rsvp_event.id, "1h")
        assert count == 1
        notif = Notification.objects.filter(
            notification_type="event_reminder", user=second_user
        ).first()
        assert notif is not None
        assert "Om 1 time" in notif.title

    def test_24h_reminder_title_says_i_morgen(self, db, user, event):
        """The 24h reminder uses 'I morgen' in the title."""
        from apps.notifications.models import Notification
        from apps.notifications.services import notify_event_reminder

        notify_event_reminder(event.id, "24h")
        notif = Notification.objects.filter(notification_type="event_reminder", user=user).first()
        assert notif is not None
        assert "I morgen" in notif.title

    def test_1h_reminder_title_says_om_1_time(self, db, user, event):
        """The 1h reminder uses 'Om 1 time' in the title."""
        from apps.notifications.models import Notification
        from apps.notifications.services import notify_event_reminder

        notify_event_reminder(event.id, "1h")
        notif = Notification.objects.filter(notification_type="event_reminder", user=user).first()
        assert notif is not None
        assert "Om 1 time" in notif.title


class TestEventDeletion:
    def test_folder_persists_on_event_delete(self, authenticated_client, db, user):
        """Deleting an event does not cascade to the linked folder."""
        from apps.forum.models import Folder, Subgroup

        subgroup = Subgroup.objects.create(name="Del Group", slug="del-group")
        folder = Folder.objects.create(subgroup=subgroup, name="Event Folder")
        now = timezone.now()
        event = Event.objects.create(
            title="Event With Folder",
            created_by=user,
            visibility=Event.Visibility.COMMUNITY,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
            subgroup=subgroup,
            folder=folder,
        )
        response = authenticated_client.delete(f"/api/events/{event.id}/")
        assert response.status_code == 204
        assert not Event.objects.filter(id=event.id).exists()
        # Folder must survive the event deletion (SET_NULL, not CASCADE)
        assert Folder.objects.filter(id=folder.id).exists()

    def test_room_not_deleted_on_event_delete(self, authenticated_client, db, user):
        """Deleting an event with a room frees the booking but keeps the room record."""
        from apps.bookings.models import Room

        room = Room.objects.create(name="Festsal")
        now = timezone.now()
        event = Event.objects.create(
            title="Lokale Booking",
            created_by=user,
            visibility=Event.Visibility.PRIVATE,
            room=room,
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
        )
        response = authenticated_client.delete(f"/api/events/{event.id}/")
        assert response.status_code == 204
        assert Room.objects.filter(id=room.id).exists()
