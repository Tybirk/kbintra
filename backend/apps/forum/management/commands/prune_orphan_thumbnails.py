"""Delete orphan thumbnail files in post_attachments/thumbs/ that no
PostAttachment row references.

These accumulate when an attachment's FileField is saved multiple times
with the same target name — Django's storage backend appends random
suffixes to avoid collisions, but only the most recent name is tracked
in the DB. When the row is later deleted, the older suffixed files are
left behind.

Dry-run by default; pass --apply to actually delete.
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.forum.models import PostAttachment


class Command(BaseCommand):
    help = "Delete orphan thumbnail files not referenced by any PostAttachment."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually delete files. Without this flag, only lists what would be removed.",
        )

    def handle(self, *args, **options) -> None:
        apply = options["apply"]

        media_root = Path(settings.MEDIA_ROOT)
        thumbs_dir = media_root / "post_attachments" / "thumbs"
        if not thumbs_dir.exists():
            self.stdout.write(self.style.WARNING(f"No directory at {thumbs_dir} — nothing to do."))
            return

        # `thumbnail` is stored as a path relative to MEDIA_ROOT, e.g.
        # "post_attachments/thumbs/123.jpg". Compare against the same form.
        referenced = set(
            PostAttachment.objects.exclude(thumbnail="")
            .exclude(thumbnail__isnull=True)
            .values_list("thumbnail", flat=True)
        )

        orphans = []
        for path in thumbs_dir.iterdir():
            if not path.is_file():
                continue
            rel = str(path.relative_to(media_root))
            if rel not in referenced:
                orphans.append(path)

        total_bytes = sum(p.stat().st_size for p in orphans)
        verb = "Deleting" if apply else "Would delete"
        self.stdout.write(
            f"Found {len(orphans)} orphan files ({total_bytes / 1024:.0f} KB total). {verb}:"
        )
        for p in orphans:
            self.stdout.write(f"  {p.name}")

        if not orphans:
            return

        if apply:
            for p in orphans:
                p.unlink()
            self.stdout.write(self.style.SUCCESS(f"Deleted {len(orphans)} files."))
        else:
            self.stdout.write("Re-run with --apply to actually delete.")
