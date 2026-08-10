"""Generate web-viewable JPEG previews for existing HEIC/HEIF attachments.

HEIC/HEIF (iPhone) images can't be rendered by Chrome/Firefox/Android in an
<img> tag. New uploads get a converted `preview` automatically; run this once
after deploy to backfill historical attachments (e.g. photos migrated from the
old intra). Covers forum, messaging, and announcement attachments.

Idempotent: skips rows that already have a preview or whose filename isn't HEIC.
By default queues work via Huey; pass --sync to generate inline (useful in dev).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.forum.image_processing import generate_attachment_preview, is_heic
from apps.forum.tasks import generate_attachment_preview_task

# (app_label, model_name) of every attachment model with file/name/preview.
_ATTACHMENT_MODELS = [
    ("forum", "PostAttachment"),
    ("messaging", "MessageAttachment"),
    ("announcements", "AnnouncementAttachment"),
]


class Command(BaseCommand):
    help = "Generate web previews for existing HEIC/HEIF attachments (all apps)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Generate previews inline instead of queueing Huey tasks.",
        )

    def handle(self, *args, **options) -> None:
        from django.apps import apps as django_apps

        sync = options["sync"]
        self.stdout.write(f"Backfilling HEIC previews ({'sync' if sync else 'queue'} mode)")

        grand_queued = 0
        grand_skipped = 0
        grand_failed = 0

        for app_label, model_name in _ATTACHMENT_MODELS:
            model = django_apps.get_model(app_label, model_name)
            qs = model.objects.filter(Q(preview="") | Q(preview__isnull=True))
            total = qs.count()
            self.stdout.write(f"{app_label}.{model_name}: scanning {total} without preview")

            queued = 0
            skipped = 0
            failed = 0

            for att in qs.iterator(chunk_size=200):
                if not is_heic(att.name):
                    skipped += 1
                    continue

                if sync:
                    # Returns False for anything it couldn't convert — including a
                    # missing source file, which it logs with the attachment id.
                    if not generate_attachment_preview(att):
                        failed += 1
                        continue
                else:
                    generate_attachment_preview_task(app_label, model_name, att.id)

                queued += 1

            self.stdout.write(
                f"  {app_label}.{model_name}: queued/generated={queued} "
                f"non_heic_skipped={skipped} failed={failed}"
            )
            grand_queued += queued
            grand_skipped += skipped
            grand_failed += failed

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. queued/generated={grand_queued} "
                f"non_heic_skipped={grand_skipped} failed={grand_failed}"
            )
        )
