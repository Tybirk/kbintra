"""
Global search API endpoint using FTS5 full-text search.
"""

import re
from collections import defaultdict

from django.db.models import Q
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.announcements.models import Announcement
from apps.events.models import Event
from apps.forum.models import File, Folder, Post, Subgroup, Thread
from apps.forum.services import member_subgroup_ids
from apps.houses.models import Car, House
from apps.houses.utils import format_license_plate, normalize_license_plate
from apps.reports.models import Report
from apps.users.models import User

from .services import (
    create_excerpt,
    fts_search_advanced,
    fts_search_per_type,
    fuzzy_name_matches,
    substring_name_matches,
)

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
    "folder": "folders",
    "report": "reports",
}

# Display priority for result groups (most useful types first).
# Subgroups are first so a user typing a forum name lands directly on it
# instead of scrolling past people/threads first. The frontend uses this
# ordering instead of alphabetical sort. Groups without results are pushed
# to the end of the order in the response (see end of `get`).
GROUP_DISPLAY_ORDER = [
    "subgroups",
    "users",
    "threads",
    "posts",
    "announcements",
    "events",
    "reports",
    "houses",
    "cars",
    "files",
    "folders",
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
                {"detail": "Søgningen skal være på mindst 2 tegn."},
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
                        "url": f"/beboere/hus/{house.slug}",
                        "created_at": house.created_at.isoformat() if house.created_at else "",
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
                        "created_at": user.date_joined.isoformat() if user.date_joined else "",
                    }
                )

        # Track IDs already added by heuristic 1 to avoid duplicates
        seen: dict[str, set[int]] = defaultdict(set)
        for key, items in results.items():
            for item in items:
                seen[key].add(item["id"])

        # FTS5 search — fetch top-N per type via a single windowed query so
        # one dominant type (e.g. files matching "Dagsorden") doesn't crowd
        # out all the other buckets. Fetch limit*2 per type to give the
        # visibility filter a buffer for any rows it has to drop.
        for item in fts_search_per_type(query, limit * 2):
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
                        "created_at": item.get("created_at") or "",
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
                            "created_at": user.date_joined.isoformat() if user.date_joined else "",
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
                            "created_at": subgroup.created_at.isoformat()
                            if subgroup.created_at
                            else "",
                        }
                    )
            results["subgroups"] = (injected + results["subgroups"])[:limit]

        # Heuristic 4: License plate direct lookup.
        # Normalize the query (strip whitespace, uppercase) so users can search
        # with or without the standard "AB 12 345" spacing. Danish plates are
        # 2 letters + 5 digits; allow 1+ digits so partial prefixes work too.
        plate_query = normalize_license_plate(query)
        if re.match(r"^[A-Z]{2}\d{1,5}$", plate_query):
            plate_matches = Car.objects.filter(
                license_plate__istartswith=plate_query
            ).select_related("house")[:limit]
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
                            "title": format_license_plate(car.license_plate),
                            "subtitle": " · ".join(subtitle_parts),
                            "url": f"/beboere/hus/{car.house.slug}",
                            "created_at": car.created_at.isoformat() if car.created_at else "",
                        }
                    )
            results["cars"] = (injected + results["cars"])[:limit]

        # Heuristic 5: Fuzzy name match across subgroups / users / houses /
        # folders. Catches typos like 'husgrupen' → 'Husgruppen' and
        # 'Tarkild' → 'Terkild' that FTS misses entirely. Bounded sets
        # (≤~500 rows total) so the Levenshtein scan is well under 10ms.
        # Only adds matches not already in the bucket; never displaces FTS hits.
        # Threshold is 4 chars because fuzzy_name_matches requires a token of
        # length ≥ 4 to tolerate any edits at all.
        if len(query) >= 4:
            self._apply_fuzzy_fallback(query, results, seen, limit)

        # Filter out members-only content the user can't see.
        # We do this after collection (rather than at FTS time) because the FTS
        # index doesn't store members_only state.
        apply_visibility_filters(results, request.user)

        # FTS5 stores Danish-folded titles for matching; swap in the originals
        # before returning so the UI shows "Grønt udvalg" instead of "Groent
        # udvalg". Purely display — no effect on what was matched.
        restore_original_titles(results)

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

    def _apply_fuzzy_fallback(
        self,
        query: str,
        results: dict[str, list[dict]],
        seen: dict[str, set[int]],
        limit: int,
    ) -> None:
        """Fuzzy-match query against subgroup / user / house / folder names.

        Each type has a small set of names (≤300), so we load (id, name)
        pairs, run length-scaled Levenshtein per token, and append any new
        matches to the relevant bucket up to ``limit``. FTS-ranked results
        are never displaced — fuzzy only fills empty slots.
        """
        # Subgroups
        if len(results["subgroups"]) < limit:
            subgroup_rows = list(Subgroup.objects.all())
            pairs = [(s.id, s.name) for s in subgroup_rows]
            sg_by_id = {s.id: s for s in subgroup_rows}
            for sid in fuzzy_name_matches(query, pairs):
                if sid in seen["subgroups"]:
                    continue
                sg = sg_by_id[sid]
                seen["subgroups"].add(sid)
                results["subgroups"].append(
                    {
                        "id": sid,
                        "type": "subgroup",
                        "title": sg.name,
                        "subtitle": create_excerpt(sg.description, 80) if sg.description else "",
                        "url": f"/forum/{sg.slug}",
                        "created_at": sg.created_at.isoformat() if sg.created_at else "",
                    }
                )
                if len(results["subgroups"]) >= limit:
                    break

        # Users — match against full name "First Last"
        if len(results["users"]) < limit:
            user_rows = list(User.objects.filter(is_active=True).select_related("house"))
            pairs = [(u.id, f"{u.first_name} {u.last_name}".strip() or u.email) for u in user_rows]
            users_by_id = {u.id: u for u in user_rows}
            for uid in fuzzy_name_matches(query, pairs):
                if uid in seen["users"]:
                    continue
                u = users_by_id[uid]
                seen["users"].add(uid)
                results["users"].append(
                    {
                        "id": uid,
                        "type": "user",
                        "title": u.get_full_name() or u.email,
                        "subtitle": u.house.name if u.house else "",
                        "url": f"/profil/{uid}",
                        "created_at": u.date_joined.isoformat() if u.date_joined else "",
                    }
                )
                if len(results["users"]) >= limit:
                    break

        # Houses
        if len(results["houses"]) < limit:
            house_rows = list(House.objects.all())
            pairs = [(h.id, h.name) for h in house_rows]
            house_by_id = {h.id: h for h in house_rows}
            for hid in fuzzy_name_matches(query, pairs):
                if hid in seen["houses"]:
                    continue
                h = house_by_id[hid]
                seen["houses"].add(hid)
                results["houses"].append(
                    {
                        "id": hid,
                        "type": "house",
                        "title": h.name,
                        "subtitle": create_excerpt(h.description, 80) if h.description else "",
                        "url": f"/beboere/hus/{h.slug}",
                        "created_at": h.created_at.isoformat() if h.created_at else "",
                    }
                )
                if len(results["houses"]) >= limit:
                    break

        # Folders
        if len(results["folders"]) < limit:
            folder_rows = list(
                Folder.objects.filter(subgroup__isnull=False).select_related("subgroup")
            )
            pairs = [(f.id, f.name) for f in folder_rows]
            folders_by_id = {f.id: f for f in folder_rows}
            for fid in fuzzy_name_matches(query, pairs):
                if fid in seen["folders"]:
                    continue
                f = folders_by_id[fid]
                seen["folders"].add(fid)
                results["folders"].append(
                    {
                        "id": fid,
                        "type": "folder",
                        "title": f.name,
                        "subtitle": f.subgroup.name,
                        "url": f"/forum/{f.subgroup.slug}/dokumenter/{f.slug}",
                        "created_at": f.created_at.isoformat() if f.created_at else "",
                    }
                )
                if len(results["folders"]) >= limit:
                    break


def apply_visibility_filters(results: dict[str, list[dict]], user: User) -> None:
    """Drop members-only threads/posts/files from results when user can't see them."""
    member_ids = set(member_subgroup_ids(user)) if user and user.is_authenticated else set()

    # Threads
    thread_items = results.get("threads") or []
    if thread_items:
        ids = [item["id"] for item in thread_items]
        private = dict(
            Thread.objects.filter(id__in=ids, members_only=True).values_list("id", "subgroup_id")
        )
        authored = (
            set(
                Thread.objects.filter(id__in=private.keys(), author=user).values_list(
                    "id", flat=True
                )
            )
            if user and user.is_authenticated
            else set()
        )
        results["threads"] = [
            item
            for item in thread_items
            if item["id"] not in private
            or private[item["id"]] in member_ids
            or item["id"] in authored
        ]

    # Posts (visible iff their thread is visible)
    post_items = results.get("posts") or []
    if post_items:
        ids = [item["id"] for item in post_items]
        posts = dict(Post.objects.filter(id__in=ids).values_list("id", "thread_id"))
        thread_ids = list({tid for tid in posts.values() if tid is not None})
        private_threads = dict(
            Thread.objects.filter(id__in=thread_ids, members_only=True).values_list(
                "id", "subgroup_id"
            )
        )
        authored_threads = (
            set(
                Thread.objects.filter(id__in=private_threads.keys(), author=user).values_list(
                    "id", flat=True
                )
            )
            if user and user.is_authenticated
            else set()
        )
        results["posts"] = [
            item
            for item in post_items
            if (tid := posts.get(item["id"])) is None
            or tid not in private_threads
            or private_threads[tid] in member_ids
            or tid in authored_threads
        ]

    # Files
    file_items = results.get("files") or []
    if file_items:
        ids = [item["id"] for item in file_items]
        private = dict(
            File.objects.filter(id__in=ids, members_only=True).values_list("id", "subgroup_id")
        )
        uploaded_by = (
            set(
                File.objects.filter(id__in=private.keys(), uploaded_by=user).values_list(
                    "id", flat=True
                )
            )
            if user and user.is_authenticated
            else set()
        )
        results["files"] = [
            item
            for item in file_items
            if item["id"] not in private
            or private[item["id"]] in member_ids
            or item["id"] in uploaded_by
        ]


def _replace_titles(items: list[dict], by_id: dict[int, str]) -> None:
    """Overwrite each item's title using the lookup map. Items not in the map
    are left unchanged (they may have come from a heuristic shortcut that
    already used the original spelling)."""
    for item in items:
        original = by_id.get(item["id"])
        if original:
            item["title"] = original


def restore_original_titles(results: dict[str, list[dict]]) -> None:
    """Replace FTS-returned Danish-folded titles with the source models'
    unfolded names. FTS5 stores `Grønt udvalg` as `Groent udvalg` so MATCH
    works regardless of which spelling the user types; this restores the
    original display form. One bulk query per non-empty bucket; safe to call
    on any results dict shape (missing keys are skipped).
    """
    threads = results.get("threads") or []
    if threads:
        _replace_titles(
            threads,
            dict(
                Thread.objects.filter(id__in=[i["id"] for i in threads]).values_list("id", "title")
            ),
        )

    posts = results.get("posts") or []
    if posts:
        _replace_titles(
            posts,
            dict(
                Post.objects.filter(id__in=[i["id"] for i in posts]).values_list(
                    "id", "thread__title"
                )
            ),
        )

    subgroups = results.get("subgroups") or []
    if subgroups:
        _replace_titles(
            subgroups,
            dict(
                Subgroup.objects.filter(id__in=[i["id"] for i in subgroups]).values_list(
                    "id", "name"
                )
            ),
        )

    announcements = results.get("announcements") or []
    if announcements:
        _replace_titles(
            announcements,
            dict(
                Announcement.objects.filter(id__in=[i["id"] for i in announcements]).values_list(
                    "id", "title"
                )
            ),
        )

    events = results.get("events") or []
    if events:
        _replace_titles(
            events,
            dict(Event.objects.filter(id__in=[i["id"] for i in events]).values_list("id", "title")),
        )

    houses = results.get("houses") or []
    if houses:
        _replace_titles(
            houses,
            dict(House.objects.filter(id__in=[i["id"] for i in houses]).values_list("id", "name")),
        )

    folders = results.get("folders") or []
    if folders:
        _replace_titles(
            folders,
            dict(
                Folder.objects.filter(id__in=[i["id"] for i in folders]).values_list("id", "name")
            ),
        )

    files = results.get("files") or []
    if files:
        _replace_titles(
            files,
            dict(File.objects.filter(id__in=[i["id"] for i in files]).values_list("id", "name")),
        )

    users = results.get("users") or []
    if users:
        ids = [i["id"] for i in users]
        by_id = {
            u.id: (u.get_full_name() or u.email)
            for u in User.objects.filter(id__in=ids).only("id", "first_name", "last_name", "email")
        }
        _replace_titles(users, by_id)

    # A report's indexed title is an excerpt of its description, so rebuild the
    # excerpt from the unfolded source rather than reading a single field.
    reports = results.get("reports") or []
    if reports:
        _replace_titles(
            reports,
            {
                report_id: create_excerpt(description, 80)
                for report_id, description in Report.objects.filter(
                    id__in=[i["id"] for i in reports]
                ).values_list("id", "description")
            },
        )


# Types that can be searched via the advanced endpoint. Order matters — used
# for the default `types` filter and to ensure all keys appear in the response.
ADVANCED_SEARCHABLE_TYPES = [
    "thread",
    "post",
    "announcement",
    "event",
    "report",
    "file",
    "folder",
    "subgroup",
    "user",
    "house",
    "car",
]

FUZZINESS_PREFIX = "prefix"
FUZZINESS_EXACT = "exact"
FUZZINESS_FUZZY = "fuzzy"
VALID_FUZZINESS = {FUZZINESS_EXACT, FUZZINESS_PREFIX, FUZZINESS_FUZZY}

VALID_SORTS = {"relevance", "newest"}


def _build_result_item(item: dict) -> dict:
    return {
        "id": item["object_id"],
        "type": item["type"],
        "title": item["title"],
        "subtitle": item["subtitle"] or "",
        "url": item["url"],
        "created_at": item.get("created_at") or "",
        **({"extra": item["extra"]} if item["extra"] else {}),
    }


class AdvancedSearchView(APIView):
    """
    Advanced search endpoint.

    GET /api/search/advanced/?q=<query>&types=thread,post&fuzziness=prefix
        &sort=relevance&limit=20

    Differs from the spotlight endpoint in that the caller controls:
      - which content types to search,
      - prefix vs exact vs fuzzy matching,
      - sort order (relevance / newest),
      - per-type result limit (up to 100).

    Heuristic shortcuts (house-number, license-plate, name istartswith) are
    intentionally NOT applied here — the spotlight is the discoverability
    surface; this endpoint is for users who want predictable, filterable
    full-text search.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("q", "").strip()

        if not query or len(query) < 2:
            return Response(
                {"detail": "Søgningen skal være på mindst 2 tegn."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            limit = min(int(request.query_params.get("limit", 20)), 100)
            if limit < 1:
                limit = 20
        except (ValueError, TypeError):
            limit = 20

        fuzziness = request.query_params.get("fuzziness", FUZZINESS_PREFIX)
        if fuzziness not in VALID_FUZZINESS:
            fuzziness = FUZZINESS_PREFIX

        sort = request.query_params.get("sort", "relevance")
        if sort not in VALID_SORTS:
            sort = "relevance"

        types_param = request.query_params.get("types", "").strip()
        if types_param:
            requested = {t.strip() for t in types_param.split(",") if t.strip()}
            selected_types = [t for t in ADVANCED_SEARCHABLE_TYPES if t in requested]
            if not selected_types:
                selected_types = list(ADVANCED_SEARCHABLE_TYPES)
        else:
            selected_types = list(ADVANCED_SEARCHABLE_TYPES)

        results: dict[str, list[dict]] = defaultdict(list)
        seen: dict[str, set[int]] = defaultdict(set)

        # FTS5 search. Fetch limit*2 to give visibility filter a buffer.
        prefix = fuzziness != FUZZINESS_EXACT
        fts_rows = fts_search_advanced(
            query,
            types=selected_types,
            prefix=prefix,
            sort=sort,
            per_type_limit=limit * 2,
        )
        for item in fts_rows:
            key = TYPE_TO_KEY.get(item["type"], item["type"])
            obj_id = item["object_id"]
            if obj_id in seen[key]:
                continue
            if len(results[key]) >= limit:
                continue
            seen[key].add(obj_id)
            results[key].append(_build_result_item(item))

        # Fuzzy name fallback over small bounded sets — only when caller asked
        # for fuzzy. Mirrors the spotlight behaviour but only fills empty slots.
        if fuzziness == FUZZINESS_FUZZY:
            self._apply_fuzzy_fallback(query, results, seen, selected_types, limit)

        apply_visibility_filters(results, request.user)

        # Swap FTS-folded titles for their original spellings (æ/ø/å).
        restore_original_titles(results)

        # Ensure all selected type keys exist in the response
        for t in selected_types:
            results.setdefault(TYPE_TO_KEY.get(t, t), [])

        total_count = sum(len(v) for v in results.values())

        group_order = [
            TYPE_TO_KEY.get(t, t) for t in selected_types if results[TYPE_TO_KEY.get(t, t)]
        ] + [TYPE_TO_KEY.get(t, t) for t in selected_types if not results[TYPE_TO_KEY.get(t, t)]]

        return Response(
            {
                "query": query,
                "fuzziness": fuzziness,
                "sort": sort,
                "types": selected_types,
                "results": dict(results),
                "total_count": total_count,
                "group_order": group_order,
            }
        )

    def _apply_fuzzy_fallback(
        self,
        query: str,
        results: dict[str, list[dict]],
        seen: dict[str, set[int]],
        selected_types: list[str],
        limit: int,
    ) -> None:
        """Augment name-like buckets with substring + Levenshtein matches.

        FTS5 only does prefix matching against whole tokens, so a query like
        "udva" misses "Børne- og ungeudvalget". Fuzzy mode therefore also runs
        a normalised substring scan and a token-level Levenshtein scan over
        bounded name sets (~50-300 rows each), and appends new hits to the
        relevant bucket. FTS hits are never displaced.
        """
        self._fill_name_bucket(
            "subgroup",
            "subgroups",
            selected_types,
            results,
            seen,
            query,
            limit,
            self._collect_subgroup_pairs,
            self._make_subgroup_item,
        )
        self._fill_name_bucket(
            "user",
            "users",
            selected_types,
            results,
            seen,
            query,
            limit,
            self._collect_user_pairs,
            self._make_user_item,
        )
        self._fill_name_bucket(
            "house",
            "houses",
            selected_types,
            results,
            seen,
            query,
            limit,
            self._collect_house_pairs,
            self._make_house_item,
        )
        self._fill_name_bucket(
            "folder",
            "folders",
            selected_types,
            results,
            seen,
            query,
            limit,
            self._collect_folder_pairs,
            self._make_folder_item,
        )

    @staticmethod
    def _fill_name_bucket(
        type_key: str,
        bucket_key: str,
        selected_types: list[str],
        results: dict[str, list[dict]],
        seen: dict[str, set[int]],
        query: str,
        limit: int,
        collect_pairs,
        make_item,
    ) -> None:
        if type_key not in selected_types or len(results[bucket_key]) >= limit:
            return
        pairs, by_id = collect_pairs()
        if not pairs:
            return
        # Substring first (catches infix matches), then Levenshtein (catches
        # typos). Both append in order; FTS hits already filled top slots.
        for finder in (substring_name_matches, fuzzy_name_matches):
            for obj_id in finder(query, pairs):
                if obj_id in seen[bucket_key]:
                    continue
                seen[bucket_key].add(obj_id)
                results[bucket_key].append(make_item(by_id[obj_id]))
                if len(results[bucket_key]) >= limit:
                    return

    @staticmethod
    def _collect_subgroup_pairs():
        rows = list(Subgroup.objects.all())
        return [(s.id, s.name) for s in rows], {s.id: s for s in rows}

    @staticmethod
    def _make_subgroup_item(sg) -> dict:
        return {
            "id": sg.id,
            "type": "subgroup",
            "title": sg.name,
            "subtitle": create_excerpt(sg.description, 80) if sg.description else "",
            "url": f"/forum/{sg.slug}",
            "created_at": sg.created_at.isoformat() if sg.created_at else "",
        }

    @staticmethod
    def _collect_user_pairs():
        rows = list(User.objects.filter(is_active=True).select_related("house"))
        pairs = [(u.id, f"{u.first_name} {u.last_name}".strip() or u.email) for u in rows]
        return pairs, {u.id: u for u in rows}

    @staticmethod
    def _make_user_item(u) -> dict:
        return {
            "id": u.id,
            "type": "user",
            "title": u.get_full_name() or u.email,
            "subtitle": u.house.name if u.house else "",
            "url": f"/profil/{u.id}",
            "created_at": u.date_joined.isoformat() if u.date_joined else "",
        }

    @staticmethod
    def _collect_house_pairs():
        rows = list(House.objects.all())
        return [(h.id, h.name) for h in rows], {h.id: h for h in rows}

    @staticmethod
    def _make_house_item(h) -> dict:
        return {
            "id": h.id,
            "type": "house",
            "title": h.name,
            "subtitle": create_excerpt(h.description, 80) if h.description else "",
            "url": f"/beboere/hus/{h.slug}",
            "created_at": h.created_at.isoformat() if h.created_at else "",
        }

    @staticmethod
    def _collect_folder_pairs():
        rows = list(Folder.objects.filter(subgroup__isnull=False).select_related("subgroup"))
        return [(f.id, f.name) for f in rows], {f.id: f for f in rows}

    @staticmethod
    def _make_folder_item(f) -> dict:
        return {
            "id": f.id,
            "type": "folder",
            "title": f.name,
            "subtitle": f.subgroup.name,
            "url": f"/forum/{f.subgroup.slug}/dokumenter/{f.slug}",
            "created_at": f.created_at.isoformat() if f.created_at else "",
        }
