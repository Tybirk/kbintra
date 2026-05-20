"""Generate thumbnails for existing House.profile_picture and
Child.profile_picture rows.

Idempotent. Default mode queues via Huey; --sync runs inline.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.forum.image_processing import generate_thumbnail
from apps.houses.models import Child, House
from apps.houses.tasks import (
    generate_child_thumbnail_task,
    generate_house_thumbnail_task,
)


def _backfill(model, task_fn, label: str, stdout, style, sync: bool) -> tuple[int, int]:
    qs = model.objects.exclude(Q(profile_picture="") | Q(profile_picture__isnull=True)).filter(
        Q(profile_picture_thumbnail="") | Q(profile_picture_thumbnail__isnull=True)
    )
    total = qs.count()
    stdout.write(
        f"Scanning {total} {label}s missing thumbnails ({'sync' if sync else 'queue'} mode)"
    )
    done = 0
    failed = 0
    for i, obj in enumerate(qs.iterator(chunk_size=200), start=1):
        if sync:
            try:
                with obj.profile_picture.open("rb") as src:
                    thumb = generate_thumbnail(src)
            except FileNotFoundError:
                stdout.write(style.WARNING(f"  missing source for {label} {obj.id}"))
                failed += 1
                continue
            if thumb is None:
                failed += 1
                continue
            obj.profile_picture_thumbnail.save(f"{obj.id}.jpg", thumb, save=True)
        else:
            task_fn(obj.id)
        done += 1
        if i % 50 == 0:
            stdout.write(f"  processed {i} / {total}")
    return done, failed


class Command(BaseCommand):
    help = "Generate thumbnails for existing House + Child profile pictures."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync",
            action="store_true",
            help="Generate inline instead of queueing Huey tasks.",
        )

    def handle(self, *args, **options) -> None:
        sync = options["sync"]
        h_done, h_failed = _backfill(
            House, generate_house_thumbnail_task, "house", self.stdout, self.style, sync
        )
        c_done, c_failed = _backfill(
            Child, generate_child_thumbnail_task, "child", self.stdout, self.style, sync
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Done. houses={h_done}/+{h_failed}failed children={c_done}/+{c_failed}failed"
            )
        )
