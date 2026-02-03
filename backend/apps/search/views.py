"""
Global search API endpoint.
"""

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.calendar_app.models import Event
from apps.forum.models import File, Post, Subgroup, Thread
from apps.houses.models import House
from apps.users.models import User

from .services import create_excerpt, search_queryset


class GlobalSearchView(APIView):
    """
    Global search endpoint with fuzzy matching.
    GET /api/search/?q=<query>&limit=<limit>&threshold=<threshold>
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("q", "").strip()

        # Parse and validate limit parameter
        try:
            limit = min(int(request.query_params.get("limit", 5)), 20)
            if limit < 1:
                limit = 5
        except (ValueError, TypeError):
            limit = 5

        # Parse and validate threshold parameter
        try:
            threshold = int(request.query_params.get("threshold", 60))
            if threshold < 0 or threshold > 100:
                threshold = 60
        except (ValueError, TypeError):
            threshold = 60

        if not query or len(query) < 2:
            return Response(
                {"detail": "Query must be at least 2 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results = {
            "users": self._search_users(query, limit, threshold),
            "threads": self._search_threads(query, limit, threshold),
            "posts": self._search_posts(query, limit, threshold),
            "subgroups": self._search_subgroups(query, limit, threshold),
            "announcements": self._search_announcements(query, limit, threshold),
            "events": self._search_events(query, limit, threshold),
            "houses": self._search_houses(query, limit, threshold),
            "files": self._search_files(query, limit, threshold),
        }

        total_count = sum(len(v) for v in results.values())

        return Response(
            {
                "query": query,
                "results": results,
                "total_count": total_count,
            }
        )

    def _search_users(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search users by name and email."""
        queryset = User.objects.filter(is_active=True)
        matches = search_queryset(
            queryset,
            ["first_name", "last_name", "email"],
            query,
            limit,
            threshold,
        )
        return [
            {
                "id": user.id,
                "type": "user",
                "title": user.get_full_name() or user.email,
                "subtitle": user.house.name if user.house else "",
                "url": f"/profil/{user.id}",
                "score": score,
            }
            for user, score in matches
        ]

    def _search_threads(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search threads by title."""
        queryset = Thread.objects.select_related("subgroup", "author")
        matches = search_queryset(queryset, ["title"], query, limit, threshold)
        return [
            {
                "id": thread.id,
                "type": "thread",
                "title": thread.title,
                "subtitle": thread.subgroup.name,
                "url": f"/forum/{thread.subgroup.slug}/{thread.id}",
                "score": score,
            }
            for thread, score in matches
        ]

    def _search_posts(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search posts by content."""
        queryset = Post.objects.select_related("thread__subgroup", "author")
        matches = search_queryset(queryset, ["content"], query, limit, threshold)
        return [
            {
                "id": post.id,
                "type": "post",
                "title": post.thread.title,
                "subtitle": create_excerpt(post.content, 80),
                "url": f"/forum/{post.thread.subgroup.slug}/{post.thread.id}",
                "score": score,
                "extra": {"thread_id": post.thread.id},
            }
            for post, score in matches
        ]

    def _search_subgroups(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search subgroups by name and description."""
        queryset = Subgroup.objects.all()
        matches = search_queryset(queryset, ["name", "description"], query, limit, threshold)
        return [
            {
                "id": subgroup.id,
                "type": "subgroup",
                "title": subgroup.name,
                "subtitle": create_excerpt(subgroup.description, 80),
                "url": f"/forum/{subgroup.slug}",
                "score": score,
            }
            for subgroup, score in matches
        ]

    def _search_announcements(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search announcements by title and content."""
        queryset = Announcement.objects.filter(is_active=True).select_related("author")
        matches = search_queryset(queryset, ["title", "content"], query, limit, threshold)
        return [
            {
                "id": announcement.id,
                "type": "announcement",
                "title": announcement.title,
                "subtitle": create_excerpt(announcement.content, 80),
                "url": "/opslag",
                "score": score,
            }
            for announcement, score in matches
        ]

    def _search_events(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search events by title, description, and location."""
        queryset = Event.objects.select_related("created_by")
        matches = search_queryset(
            queryset, ["title", "description", "location"], query, limit, threshold
        )
        return [
            {
                "id": event.id,
                "type": "event",
                "title": event.title,
                "subtitle": event.location or create_excerpt(event.description, 80),
                "url": "/kalender",
                "score": score,
            }
            for event, score in matches
        ]

    def _search_houses(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search houses by name and description."""
        queryset = House.objects.all()
        matches = search_queryset(queryset, ["name", "description"], query, limit, threshold)
        return [
            {
                "id": house.id,
                "type": "house",
                "title": house.name,
                "subtitle": create_excerpt(house.description, 80),
                "url": "/beboere",
                "score": score,
            }
            for house, score in matches
        ]

    def _search_files(self, query: str, limit: int, threshold: int) -> list[dict]:
        """Search files by name."""
        queryset = File.objects.select_related("subgroup", "uploaded_by")
        matches = search_queryset(queryset, ["name"], query, limit, threshold)
        return [
            {
                "id": file.id,
                "type": "file",
                "title": file.name,
                "subtitle": file.subgroup.name,
                "url": f"/forum/{file.subgroup.slug}",
                "score": score,
                "extra": {
                    "file_url": file.file.url,
                },
            }
            for file, score in matches
        ]
