"""Generate thumbnails for existing PostAttachment image rows.

Run once after deploying the thumbnail feature to backfill historical
attachments. Idempotent: skips rows that already have a thumbnail or whose
filename isn't an image. By default queues work via Huey; pass --sync to
generate inline (useful during local development).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.forum.image_processing import (
    generate_thumbnail,
    is_image_attachment,
)
from apps.forum.models import PostAttachment
from apps.forum.tasks import generate_post_attachment_thumbnail_task


class Command(BaseCommand):
    help = "Generate thumbnails for existing PostAttachment image rows."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Generate thumbnails inline instead of queueing Huey tasks.",
        )

    def handle(self, *args, **options) -> None:
        sync = options["sync"]

        qs = PostAttachment.objects.filter(Q(thumbnail="") | Q(thumbnail__isnull=True))
        total = qs.count()
        self.stdout.write(
            f"Scanning {total} attachments without thumbnails ({'sync' if sync else 'queue'} mode)"
        )

        queued = 0
        skipped = 0
        failed = 0

        for i, att in enumerate(qs.iterator(chunk_size=200), start=1):
            if not is_image_attachment(att.name):
                skipped += 1
                continue

            if sync:
                try:
                    with att.file.open("rb") as src:
                        thumb = generate_thumbnail(src)
                except FileNotFoundError:
                    self.stdout.write(
                        self.style.WARNING(f"  missing source for attachment {att.id} ({att.name})")
                    )
                    failed += 1
                    continue
                if thumb is None:
                    failed += 1
                    continue
                att.thumbnail.save(f"{att.id}.jpg", thumb, save=True)
            else:
                generate_post_attachment_thumbnail_task(att.id)

            queued += 1

            if i % 100 == 0:
                self.stdout.write(f"  processed {i} / {total}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. queued/generated={queued} non_image_skipped={skipped} failed={failed}"
            )
        )
