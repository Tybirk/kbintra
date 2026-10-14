"""Generate chat-bubble thumbnails for existing MessageAttachment images.

Run once after deploying message thumbnails to backfill historical attachments;
new uploads get theirs at upload time. Idempotent: skips rows that already have
a thumbnail or aren't images. Runs inline — ~200 images take seconds.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.forum.image_processing import generate_attachment_thumbnail, is_image_attachment
from apps.messaging.models import MessageAttachment


class Command(BaseCommand):
    help = "Generate thumbnails for existing MessageAttachment image rows."

    def handle(self, *args, **options) -> None:
        qs = MessageAttachment.objects.filter(Q(thumbnail="") | Q(thumbnail__isnull=True))
        self.stdout.write(f"Scanning {qs.count()} attachments without thumbnails")

        generated = skipped = failed = 0
        for att in qs.iterator(chunk_size=200):
            if not is_image_attachment(att.name):
                skipped += 1
            elif generate_attachment_thumbnail(att):
                generated += 1
            else:
                failed += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Done: generated={generated} non_image_skipped={skipped} failed={failed}"
            )
        )
