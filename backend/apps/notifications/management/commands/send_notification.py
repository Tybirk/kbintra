"""
Management command to send push notifications to users matching an email pattern.
"""

import re

from django.core.management.base import BaseCommand, CommandError

from apps.notifications.models import NotificationType
from apps.notifications.services import send_push_notification
from apps.users.models import User


class Command(BaseCommand):
    help = "Send push notifications to users matching an email pattern"

    def add_arguments(self, parser):
        parser.add_argument(
            "pattern",
            type=str,
            help="Email pattern to match (regex supported, e.g. '.*@gmail.com' or 'john')",
        )
        parser.add_argument(
            "--title",
            type=str,
            default="Test notification",
            help="Notification title (default: 'Test notification')",
        )
        parser.add_argument(
            "--message",
            type=str,
            default="This is a test notification.",
            help="Notification message (default: 'This is a test notification.')",
        )
        parser.add_argument(
            "--link",
            type=str,
            default="",
            help="Optional link to open when notification is clicked",
        )
        parser.add_argument(
            "--type",
            type=str,
            default="new_announcement",
            choices=[t.value for t in NotificationType],
            help="Notification type for preference checking (default: new_announcement)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show matching users without sending notifications",
        )

    def handle(self, *args, **options):
        pattern = options["pattern"]
        title = options["title"]
        message = options["message"]
        link = options["link"]
        notification_type = options["type"]
        dry_run = options["dry_run"]

        # Compile regex pattern
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            raise CommandError(f"Invalid regex pattern: {e}") from e

        # Find matching users
        all_users = User.objects.filter(is_active=True)
        matching_users = [user for user in all_users if regex.search(user.email)]

        if not matching_users:
            self.stdout.write(self.style.WARNING(f"No users found matching pattern: {pattern}"))
            return

        self.stdout.write(f"Found {len(matching_users)} user(s) matching pattern '{pattern}':")
        for user in matching_users:
            self.stdout.write(f"  - {user.email} ({user.first_name} {user.last_name})")

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING("Dry run - no push notifications sent"))
            self.stdout.write("Would send push notification:")
            self.stdout.write(f"  Title: {title}")
            self.stdout.write(f"  Message: {message}")
            self.stdout.write(f"  Link: {link or '(none)'}")
            return

        # Send push notifications
        total_sent = 0
        users_notified = 0

        for user in matching_users:
            result = send_push_notification(
                user=user,
                notification_type=NotificationType(notification_type),
                title=title,
                message=message,
                link=link,
            )
            sub_count = result["total"]
            success_ids = result["success_ids"]
            expired_ids = result["expired_ids"]
            failed_ids = result["failed_ids"]

            if sub_count == 0:
                self.stdout.write(f"  No subscriptions for {user.email}")
            else:
                self.stdout.write(f"  {user.email} has {sub_count} subscription(s):")
                if success_ids:
                    users_notified += 1
                    total_sent += len(success_ids)
                    self.stdout.write(self.style.SUCCESS(f"    ✓ Sent: {success_ids}"))
                if expired_ids:
                    self.stdout.write(self.style.WARNING(f"    ✗ Expired: {expired_ids}"))
                if failed_ids:
                    self.stdout.write(self.style.ERROR(f"    ✗ Failed: {failed_ids}"))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 50))
        self.stdout.write(
            self.style.SUCCESS(
                f"Sent {total_sent} push notification(s) to {users_notified} user(s)"
            )
        )
