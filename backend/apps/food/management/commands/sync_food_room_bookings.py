"""
Management command to create/update recurring bookings for food rooms
(Spisesal + Køkken) for a given year, with exceptions for closed food days.
"""

import datetime

from django.core.management.base import BaseCommand

from apps.bookings.models import RecurringBooking, RecurringBookingException, Room
from apps.food.models import ClosedFoodDay
from apps.users.models import User

FOOD_ROOMS = [
    {
        "name": "Spisesal",
        "title": "Fællesspisning",
        "start_time": datetime.time(17, 0),
        "end_time": datetime.time(21, 0),
    },
    {
        "name": "Køkken",
        "title": "Madlavning",
        "start_time": datetime.time(14, 0),
        "end_time": datetime.time(21, 0),
    },
]


class Command(BaseCommand):
    help = "Sync recurring food room bookings for a year, adding exceptions for closed food days."

    def add_arguments(self, parser):
        parser.add_argument(
            "year",
            type=int,
            help="Year to create bookings for (e.g. 2026)",
        )

    def handle(self, *args, **options):
        year = options["year"]
        effective_from = datetime.date(year, 1, 1)
        effective_until = datetime.date(year, 12, 31)

        # Use the first staff user as the booking creator
        admin_user = User.objects.filter(is_staff=True).first()
        if not admin_user:
            self.stderr.write(self.style.ERROR("No staff user found."))
            return

        # Get all closed food days for this year
        closed_dates = list(
            ClosedFoodDay.objects.filter(
                date__gte=effective_from, date__lte=effective_until
            ).values_list("date", flat=True)
        )

        for room_config in FOOD_ROOMS:
            room, _ = Room.objects.get_or_create(
                name=room_config["name"],
                defaults={"is_active": True},
            )

            # Find or create the recurring booking
            booking, created = RecurringBooking.objects.update_or_create(
                room=room,
                title=room_config["title"],
                effective_from=effective_from,
                effective_until=effective_until,
                defaults={
                    "days_of_week": [0, 1, 2, 3],  # Mon-Thu
                    "start_time": room_config["start_time"],
                    "end_time": room_config["end_time"],
                    "is_active": True,
                    "created_by": admin_user,
                },
            )

            if created:
                self.stdout.write(f"  Created recurring booking: {booking}")
            else:
                self.stdout.write(f"  Updated recurring booking: {booking}")

            # Sync exceptions: add missing, remove stale
            existing_exceptions = set(booking.exceptions.values_list("exception_date", flat=True))
            desired_exceptions = set(closed_dates)

            # Add new exceptions
            to_add = desired_exceptions - existing_exceptions
            if to_add:
                RecurringBookingException.objects.bulk_create(
                    [
                        RecurringBookingException(recurring_booking=booking, exception_date=d)
                        for d in to_add
                    ],
                    ignore_conflicts=True,
                )
                self.stdout.write(f"    Added {len(to_add)} exceptions")

            # Remove exceptions that are no longer closed
            to_remove = existing_exceptions - desired_exceptions
            if to_remove:
                booking.exceptions.filter(exception_date__in=to_remove).delete()
                self.stdout.write(f"    Removed {len(to_remove)} stale exceptions")

            if not to_add and not to_remove:
                self.stdout.write("    Exceptions already in sync")

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced food room bookings for {year} with {len(closed_dates)} closed days."
            )
        )
