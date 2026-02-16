"""
Management command to rebuild the FTS5 search index from scratch.
"""

import json

from django.core.management.base import BaseCommand
from django.db import connection

from apps.search.services import create_excerpt, index_object, strip_html


def _isoformat(dt) -> str:
    return dt.isoformat() if dt else ""


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

        # Clear the entire FTS5 table
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM search_index")

        counts = {}

        # Users
        from apps.users.models import User

        users = User.objects.filter(is_active=True).select_related("house")
        for user in users:
            index_object(
                obj_type="user",
                object_id=user.id,
                title=user.get_full_name() or user.email,
                body=user.email,
                url=f"/profil/{user.id}",
                subtitle=user.house.name if user.house_id else "",
                created_at=_isoformat(user.date_joined),
            )
        counts["users"] = users.count()

        # Houses
        from apps.houses.models import House

        houses = House.objects.all()
        for house in houses:
            index_object(
                obj_type="house",
                object_id=house.id,
                title=house.name,
                body=strip_html(house.description) if house.description else "",
                url=f"/beboere/hus/{house.id}",
                subtitle=create_excerpt(house.description, 80) if house.description else "",
                created_at=_isoformat(house.created_at),
            )
        counts["houses"] = houses.count()

        # Threads
        from apps.forum.models import Thread

        threads = Thread.objects.select_related("subgroup")
        for thread in threads:
            index_object(
                obj_type="thread",
                object_id=thread.id,
                title=thread.title,
                body="",
                url=f"/forum/{thread.subgroup.slug}/{thread.id}",
                subtitle=thread.subgroup.name,
                created_at=_isoformat(thread.created_at),
            )
        counts["threads"] = threads.count()

        # Posts
        from apps.forum.models import Post

        posts = Post.objects.select_related("thread__subgroup")
        for post in posts:
            index_object(
                obj_type="post",
                object_id=post.id,
                title=post.thread.title,
                body=strip_html(post.content),
                url=f"/forum/{post.thread.subgroup.slug}/{post.thread.id}",
                subtitle=create_excerpt(post.content, 80),
                extra=json.dumps({"thread_id": post.thread.id}),
                created_at=_isoformat(post.created_at),
            )
        counts["posts"] = posts.count()

        # Subgroups
        from apps.forum.models import Subgroup

        subgroups = Subgroup.objects.all()
        for subgroup in subgroups:
            index_object(
                obj_type="subgroup",
                object_id=subgroup.id,
                title=subgroup.name,
                body=strip_html(subgroup.description) if subgroup.description else "",
                url=f"/forum/{subgroup.slug}",
                subtitle=create_excerpt(subgroup.description, 80) if subgroup.description else "",
                created_at=_isoformat(subgroup.created_at),
            )
        counts["subgroups"] = subgroups.count()

        # Announcements
        from apps.announcements.models import Announcement

        announcements = Announcement.objects.filter(is_active=True)
        for announcement in announcements:
            index_object(
                obj_type="announcement",
                object_id=announcement.id,
                title=announcement.title,
                body=strip_html(announcement.content),
                url="/opslag",
                subtitle=create_excerpt(announcement.content, 80),
                created_at=_isoformat(announcement.created_at),
            )
        counts["announcements"] = announcements.count()

        # Events
        from apps.calendar_app.models import Event

        events = Event.objects.all()
        for event in events:
            index_object(
                obj_type="event",
                object_id=event.id,
                title=event.title,
                body=" ".join(
                    filter(
                        None,
                        [
                            strip_html(event.description) if event.description else "",
                            event.location or "",
                        ],
                    )
                ),
                url="/kalender",
                subtitle=event.location or create_excerpt(event.description, 80),
                created_at=_isoformat(event.created_at),
            )
        counts["events"] = events.count()

        # Files
        from apps.forum.models import File

        files = File.objects.select_related("subgroup")
        for file in files:
            index_object(
                obj_type="file",
                object_id=file.id,
                title=file.name,
                body="",
                url=f"/forum/{file.subgroup.slug}",
                subtitle=file.subgroup.name,
                extra=json.dumps({"file_url": file.file.url}),
                created_at=_isoformat(file.uploaded_at),
            )
        counts["files"] = files.count()

        total = sum(counts.values())
        self.stdout.write(f"Indexed {total} objects:")
        for type_name, count in counts.items():
            self.stdout.write(f"  {type_name}: {count}")
        self.stdout.write(self.style.SUCCESS("Search index rebuilt successfully."))
