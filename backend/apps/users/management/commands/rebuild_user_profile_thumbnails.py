"""Generate thumbnails for existing User.profile_picture rows.

Idempotent: skips rows that already have a thumbnail or have no profile
picture. Default mode queues via Huey; --sync runs inline.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.forum.image_processing import generate_thumbnail
from apps.users.models import User
from apps.users.tasks import generate_user_profile_thumbnail_task


class Command(BaseCommand):
    help = "Generate thumbnails for existing User.profile_picture rows."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Generate inline instead of queueing Huey tasks.",
        )

    def handle(self, *args, **options) -> None:
        sync = options["sync"]
        qs = User.objects.exclude(profile_picture="").filter(
            Q(profile_picture_thumbnail="") | Q(profile_picture_thumbnail__isnull=True)
        )
        total = qs.count()
        self.stdout.write(
            f"Scanning {total} users with profile pictures missing thumbnails "
            f"({'sync' if sync else 'queue'} mode)"
        )

        done = 0
        failed = 0
        for i, user in enumerate(qs.iterator(chunk_size=200), start=1):
            if sync:
                try:
                    with user.profile_picture.open("rb") as src:
                        thumb = generate_thumbnail(src)
                except FileNotFoundError:
                    self.stdout.write(self.style.WARNING(f"  missing source for user {user.id}"))
                    failed += 1
                    continue
                if thumb is None:
                    failed += 1
                    continue
                user.profile_picture_thumbnail.save(f"{user.id}.jpg", thumb, save=True)
            else:
                generate_user_profile_thumbnail_task(user.id)
            done += 1

            if i % 50 == 0:
                self.stdout.write(f"  processed {i} / {total}")

        self.stdout.write(self.style.SUCCESS(f"Done. processed={done} failed={failed}"))
