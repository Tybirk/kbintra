"""
Validators for booking overlap detection.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from django.utils import timezone

from .models import RecurringBooking, RecurringBookingException


def _exception_dates_by_booking(recurring_bookings: list) -> dict[int, set[date]]:
    """Load every exception date for the given recurring bookings in one query.

    Returns ``{recurring_booking_id: {exception_date, ...}}`` so date-range
    expansion can check exceptions in memory instead of an N+1 per date.
    """
    by_booking: dict[int, set[date]] = defaultdict(set)
    for rb_id, exc_date in RecurringBookingException.objects.filter(
        recurring_booking__in=recurring_bookings
    ).values_list("recurring_booking_id", "exception_date"):
        by_booking[rb_id].add(exc_date)
    return by_booking


def check_booking_overlaps(
    room_id: int,
    start: datetime,
    end: datetime,
    exclude_event_id: int | None = None,
) -> dict:
    """
    Check if a booking overlaps with existing events or recurring bookings.

    Returns:
        {
            "has_conflict": bool,
            "conflicts": list of conflict descriptions
        }
    """
    from apps.events.models import Event

    conflicts: list[str] = []

    # Check one-time events with rooms
    events_query = Event.objects.filter(
        rooms=room_id,
        start_datetime__lt=end,
        end_datetime__gt=start,
    )
    if exclude_event_id:
        events_query = events_query.exclude(id=exclude_event_id)

    for event in events_query:
        conflicts.append(
            f"Overlapper med '{event.title}' "
            f"({event.start_datetime.strftime('%d/%m %H:%M')} - "
            f"{event.end_datetime.strftime('%H:%M')})"
        )

    # Check recurring bookings
    recurring_conflicts = check_recurring_overlaps(room_id, start, end)
    conflicts.extend(recurring_conflicts)

    return {
        "has_conflict": len(conflicts) > 0,
        "conflicts": conflicts,
    }


def check_recurring_overlaps(
    room_id: int,
    start: datetime,
    end: datetime,
) -> list[str]:
    """
    Check if a booking overlaps with recurring bookings.
    Expands recurring bookings for each day in the range.
    """
    conflicts: list[str] = []

    # Get all active recurring bookings for this room
    recurring_bookings = list(
        RecurringBooking.objects.filter(
            room_id=room_id,
            is_active=True,
        )
    )
    exceptions_by_booking = _exception_dates_by_booking(recurring_bookings)

    # Iterate through each day in the booking range
    current_date = start.date()
    end_date = end.date()

    while current_date <= end_date:
        for recurring in recurring_bookings:
            if not recurring.is_active_on_date(
                current_date, exceptions_by_booking.get(recurring.id, frozenset())
            ):
                continue

            # Build the actual datetime for this occurrence
            occurrence_start = timezone.make_aware(
                datetime.combine(current_date, recurring.start_time),
                timezone.get_current_timezone(),
            )
            occurrence_end = timezone.make_aware(
                datetime.combine(current_date, recurring.end_time),
                timezone.get_current_timezone(),
            )

            # Handle overnight recurring bookings
            if recurring.end_time < recurring.start_time:
                occurrence_end += timedelta(days=1)

            # Check overlap
            if start < occurrence_end and end > occurrence_start:
                conflicts.append(
                    f"Overlapper med tilbagevendende booking '{recurring.title}' "
                    f"({recurring.days_of_week_display} {recurring.start_time.strftime('%H:%M')} - "
                    f"{recurring.end_time.strftime('%H:%M')})"
                )

        current_date += timedelta(days=1)

    return conflicts


def check_multi_room_booking(
    room_ids: list[int],
    start: datetime,
    end: datetime,
    exclude_event_id: int | None = None,
) -> dict:
    """
    Check availability for multiple rooms.

    Returns:
        {
            "can_book_all": bool,
            "available_rooms": list of room IDs that are available,
            "conflicts_by_room": dict mapping room_id to list of conflicts
        }
    """
    available_rooms: list[int] = []
    conflicts_by_room: dict[int, list[str]] = {}

    for room_id in room_ids:
        result = check_booking_overlaps(room_id, start, end, exclude_event_id)
        if result["has_conflict"]:
            conflicts_by_room[room_id] = result["conflicts"]
        else:
            available_rooms.append(room_id)

    return {
        "can_book_all": len(available_rooms) == len(room_ids),
        "available_rooms": available_rooms,
        "conflicts_by_room": conflicts_by_room,
    }


def expand_recurring_bookings_for_range(
    room_id: int | None,
    start: date,
    end: date,
) -> list[dict]:
    """
    Expand recurring bookings into actual occurrences for a date range.
    Used for calendar display.

    Returns list of dicts with occurrence data.
    """
    occurrences: list[dict] = []

    query = RecurringBooking.objects.filter(is_active=True).select_related("room", "created_by")
    if room_id:
        query = query.filter(room_id=room_id)
    recurring_bookings = list(query)
    exceptions_by_booking = _exception_dates_by_booking(recurring_bookings)

    current_date = start
    while current_date <= end:
        for recurring in recurring_bookings:
            if not recurring.is_active_on_date(
                current_date, exceptions_by_booking.get(recurring.id, frozenset())
            ):
                continue

            occurrence_start = timezone.make_aware(
                datetime.combine(current_date, recurring.start_time),
                timezone.get_current_timezone(),
            )
            occurrence_end = timezone.make_aware(
                datetime.combine(current_date, recurring.end_time),
                timezone.get_current_timezone(),
            )

            # Handle overnight recurring bookings
            if recurring.end_time < recurring.start_time:
                occurrence_end += timedelta(days=1)

            occurrences.append(
                {
                    "id": f"recurring_{recurring.id}_{current_date.isoformat()}",
                    "room": {
                        "id": recurring.room.id,
                        "name": recurring.room.name,
                        "color": recurring.room.color,
                    },
                    "user": {
                        "id": recurring.created_by.id,
                        "first_name": recurring.created_by.first_name,
                        "last_name": recurring.created_by.last_name,
                        "profile_picture": recurring.created_by.avatar_url,
                    },
                    "title": recurring.title,
                    "description": recurring.description,
                    "start_datetime": occurrence_start.isoformat(),
                    "end_datetime": occurrence_end.isoformat(),
                    "is_recurring": True,
                    "recurring_booking_id": recurring.id,
                }
            )

        current_date += timedelta(days=1)

    return occurrences
