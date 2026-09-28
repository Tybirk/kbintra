"""
Management command to rebuild the FTS5 search index from scratch.

Rows come from the same builders the save signals use (`search/documents.py`),
so a rebuild writes exactly what saving each object would.
"""

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from apps.search import documents
from apps.search.services import index_object


def _sources():  # type: ignore[no-untyped-def]
    """(name, objects, builder) for every searchable model, related rows fetched up front."""
    from apps.announcements.models import Announcement
    from apps.events.models import Event
    from apps.forum.models import File, Folder, Post, Subgroup, Thread
    from apps.houses.models import Car, House
    from apps.reports.models import Report
    from apps.users.models import User

    return [
        ("users", User.objects.select_related("house"), documents.user_document),
        ("houses", House.objects.all(), documents.house_document),
        ("cars", Car.objects.select_related("house"), documents.car_document),
        ("threads", Thread.objects.select_related("subgroup"), documents.thread_document),
        ("posts", Post.objects.select_related("thread__subgroup"), documents.post_document),
        ("subgroups", Subgroup.objects.all(), documents.subgroup_document),
        ("announcements", Announcement.objects.all(), documents.announcement_document),
        ("events", Event.objects.prefetch_related("rooms"), documents.event_document),
        ("files", File.objects.select_related("subgroup"), documents.file_document),
        ("folders", Folder.objects.select_related("subgroup"), documents.folder_document),
        # submitted_by too: the row carries the reporter's name.
        (
            "reports",
            Report.objects.select_related("subgroup", "submitted_by"),
            documents.report_document,
        ),
    ]


class Command(BaseCommand):
    help = "Rebuild the FTS5 search index for all searchable models."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Only rebuild if the index is empty.",
        )

    def handle(self, *args, **options):
        if options["if_empty"]:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM search_index")
                count = cursor.fetchone()[0]
            if count > 0:
                self.stdout.write(f"Search index already has {count} entries, skipping rebuild.")
                return

        # One transaction: the inner index_object() calls become cheap savepoints
        # instead of individual commits. The table is emptied first, so each row
        # is inserted without looking for an earlier one (replace=False) — FTS5
        # can only find one by scanning, which made this O(n²).
        counts = {}
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM search_index")

            for name, objects, build in _sources():
                counts[name] = 0
                for obj in objects:
                    document = build(obj)
                    if document is not None:
                        index_object(**document, replace=False)
                        counts[name] += 1

        total = sum(counts.values())
        self.stdout.write(f"Indexed {total} objects:")
        for type_name, count in counts.items():
            self.stdout.write(f"  {type_name}: {count}")
        self.stdout.write(self.style.SUCCESS("Search index rebuilt successfully."))
