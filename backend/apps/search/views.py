"""
Global search API endpoint using FTS5 full-text search.
"""

import re
from collections import defaultdict

from django.db.models import Q
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.forum.models import Subgroup
from apps.houses.models import Car, House
from apps.users.models import User

from .services import create_excerpt, fts_search

# FTS stores singular types; API returns plural keys
TYPE_TO_KEY = {
    "user": "users",
    "thread": "threads",
    "post": "posts",
    "subgroup": "subgroups",
    "announcement": "announcements",
    "event": "events",
    "house": "houses",
    "car": "cars",
    "file": "files",
}

# Display priority for result groups (most useful types first).
# The frontend uses this ordering instead of alphabetical sort.
GROUP_DISPLAY_ORDER = [
    "users",
    "threads",
    "subgroups",
    "posts",
    "announcements",
    "events",
    "houses",
    "cars",
    "files",
]


class GlobalSearchView(APIView):
    """
    Global search endpoint using FTS5 with heuristic shortcuts.
    GET /api/search/?q=<query>&limit=<limit>
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

        # Allow 1-char queries for house numbers, otherwise require 2 chars
        is_house_number = query.isdigit() and 1 <= int(query) <= 62
        if not query or (len(query) < 2 and not is_house_number):
            return Response(
                {"detail": "Query must be at least 2 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results: dict[str, list[dict]] = defaultdict(list)

        # Heuristic 1: House number direct lookup
        if is_house_number:
            house_num = int(query)
            houses = House.objects.filter(name__iregex=rf"\b{house_num}$")
            for house in houses:
                results["houses"].append(
                    {
                        "id": house.id,
                        "type": "house",
                        "title": house.name,
                        "subtitle": create_excerpt(house.description, 80)
                        if house.description
                        else "",
                        "url": f"/beboere/hus/{house.id}",
                    }
                )
            # Also show residents of matching houses
            residents = User.objects.filter(
                is_active=True, house__name__iregex=rf"\b{house_num}$"
            ).select_related("house")
            for user in residents[:limit]:
                results["users"].append(
                    {
                        "id": user.id,
                        "type": "user",
                        "title": user.get_full_name() or user.email,
                        "subtitle": user.house.name if user.house else "",
                        "url": f"/profil/{user.id}",
                    }
                )

        # Track IDs already added by heuristic 1 to avoid duplicates
        seen: dict[str, set[int]] = defaultdict(set)
        for key, items in results.items():
            for item in items:
                seen[key].add(item["id"])

        # FTS5 search
        fts_results = fts_search(query, limit * 8)  # Get more results to distribute across types
        for item in fts_results:
            result_key = TYPE_TO_KEY.get(item["type"], item["type"])
            obj_id = item["object_id"]
            if len(results[result_key]) < limit and obj_id not in seen[result_key]:
                seen[result_key].add(obj_id)
                results[result_key].append(
                    {
                        "id": obj_id,
                        "type": item["type"],
                        "title": item["title"],
                        "subtitle": item["subtitle"] or "",
                        "url": item["url"],
                        **({"extra": item["extra"]} if item["extra"] else {}),
                    }
                )

        # Heuristic 2: User name priority — inject istartswith matches at top
        if len(query) >= 2:
            name_matches = User.objects.filter(
                Q(first_name__istartswith=query) | Q(last_name__istartswith=query),
                is_active=True,
            ).select_related("house")[:limit]
            injected = []
            for user in name_matches:
                if user.id not in seen["users"]:
                    seen["users"].add(user.id)
                    injected.append(
                        {
                            "id": user.id,
                            "type": "user",
                            "title": user.get_full_name() or user.email,
                            "subtitle": user.house.name if user.house else "",
                            "url": f"/profil/{user.id}",
                        }
                    )
            results["users"] = (injected + results["users"])[:limit]

        # Heuristic 3: Subgroup name — inject icontains matches at top
        if len(query) >= 2:
            subgroup_matches = Subgroup.objects.filter(name__icontains=query)[:limit]
            injected = []
            for subgroup in subgroup_matches:
                if subgroup.id not in seen["subgroups"]:
                    seen["subgroups"].add(subgroup.id)
                    injected.append(
                        {
                            "id": subgroup.id,
                            "type": "subgroup",
                            "title": subgroup.name,
                            "subtitle": (
                                create_excerpt(subgroup.description, 80)
                                if subgroup.description
                                else ""
                            ),
                            "url": f"/forum/{subgroup.slug}",
                        }
                    )
            results["subgroups"] = (injected + results["subgroups"])[:limit]

        # Heuristic 4: License plate direct lookup
        if re.match(r"^[A-Za-z]{2}\d{2,5}$", query):
            plate_matches = Car.objects.filter(license_plate__istartswith=query).select_related(
                "house"
            )[:limit]
            injected = []
            for car in plate_matches:
                if car.id not in seen["cars"]:
                    seen["cars"].add(car.id)
                    subtitle_parts = [car.house.name]
                    if car.is_electric:
                        subtitle_parts.append("Elbil")
                    injected.append(
                        {
                            "id": car.id,
                            "type": "car",
                            "title": car.license_plate,
                            "subtitle": " · ".join(subtitle_parts),
                            "url": f"/beboere/hus/{car.house_id}",
                        }
                    )
            results["cars"] = (injected + results["cars"])[:limit]

        # Ensure all expected keys exist
        for key in GROUP_DISPLAY_ORDER:
            results.setdefault(key, [])

        total_count = sum(len(v) for v in results.values())

        # Groups with results first (in priority order), then empty groups
        group_order = [k for k in GROUP_DISPLAY_ORDER if results[k]] + [
            k for k in GROUP_DISPLAY_ORDER if not results[k]
        ]

        return Response(
            {
                "query": query,
                "results": dict(results),
                "total_count": total_count,
                "group_order": group_order,
            }
        )
