from django.core.management.base import BaseCommand

from apps.food.services.default_registrations import apply_weekly_defaults_for_all_users


class Command(BaseCommand):
    help = "Create default meal registrations for all active users (current + next 2 weeks)."

    def handle(self, *args: object, **options: object) -> None:
        self.stdout.write("Applying weekly defaults for all users...")
        users, created = apply_weekly_defaults_for_all_users()
        self.stdout.write(
            self.style.SUCCESS(f"Done. Processed {users} users, created {created} registrations.")
        )
