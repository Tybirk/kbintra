"""Generate thumbnails for existing PostAttachment image rows.

Run once after deploying the thumbnail feature to backfill historical
attachments. Idempotent: skips rows that already have a thumbnail or whose
filename isn't an image. By default queues work via Huey; pass --sync to
generate inline (useful during local development). Pass --force to
re-generate even rows that already have a thumbnail (e.g. after changing
the thumbnail strategy).
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
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-generate even for attachments that already have a thumbnail "
            "(deletes the old file first). Use after changing the thumbnail strategy.",
        )

    def handle(self, *args, **options) -> None:
        sync = options["sync"]
        force = options["force"]

        if force:
            qs = PostAttachment.objects.all()
        else:
            qs = PostAttachment.objects.filter(Q(thumbnail="") | Q(thumbnail__isnull=True))
        total = qs.count()
        scope = "all attachments" if force else "attachments without thumbnails"
        self.stdout.write(f"Scanning {total} {scope} ({'sync' if sync else 'queue'} mode)")

        queued = 0
        skipped = 0
        failed = 0

        for i, att in enumerate(qs.iterator(chunk_size=200), start=1):
            if not is_image_attachment(att.name):
                skipped += 1
                continue

            if force and att.thumbnail:
                # Drop the stale file + clear the DB field; the inline / queued
                # branch below will then regenerate exactly as for a missing thumb.
                att.thumbnail.delete(save=False)
                PostAttachment.objects.filter(pk=att.pk).update(thumbnail="")
                att.thumbnail = None

            if sync:
                try:
                    with att.file.open("rb") as src:
                        thumb = generate_thumbnail(src, preserve_aspect=True)
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
