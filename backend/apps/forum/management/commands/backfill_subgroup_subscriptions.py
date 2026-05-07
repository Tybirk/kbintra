"""
Backfill SubgroupSubscription rows for every SubgroupMembership that lacks one.

Membership implies subscription (see apps.forum.services.add_member), but
direct DB writes / Django admin / pre-add_member memberships can leave a
membership without its corresponding subscription — which silently breaks
new-thread and reply notifications for those users.

Idempotent. Safe to re-run.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.forum.models import SubgroupMembership, SubgroupSubscription


class Command(BaseCommand):
    help = "Create a SubgroupSubscription for every SubgroupMembership that lacks one."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created without writing to the database.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        existing_pairs = set(SubgroupSubscription.objects.values_list("user_id", "subgroup_id"))
        memberships = SubgroupMembership.objects.values_list("user_id", "subgroup_id").order_by(
            "subgroup_id", "user_id"
        )

        missing = [
            (user_id, subgroup_id)
            for user_id, subgroup_id in memberships
            if (user_id, subgroup_id) not in existing_pairs
        ]

        if not missing:
            self.stdout.write(self.style.SUCCESS("No missing subscriptions — nothing to backfill."))
            return

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"Found {len(missing)} membership(s) without a subscription:"
            )
        )
        for user_id, subgroup_id in missing:
            self.stdout.write(f"  user={user_id} subgroup={subgroup_id}")

        if dry_run:
            self.stdout.write(self.style.WARNING("(Dry run - no changes made)"))
            return

        with transaction.atomic():
            SubgroupSubscription.objects.bulk_create(
                [SubgroupSubscription(user_id=uid, subgroup_id=sgid) for uid, sgid in missing],
                ignore_conflicts=True,
            )

        self.stdout.write(self.style.SUCCESS(f"Backfilled {len(missing)} subscription(s)."))
