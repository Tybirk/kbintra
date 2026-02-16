"""
Tests for the Search app (FTS5-based).
"""

import json

import pytest
from django.db import connection

from apps.announcements.models import Announcement
from apps.calendar_app.models import Event
from apps.search.services import (
    build_fts_query,
    create_excerpt,
    fts_search,
    index_object,
    remove_object,
    strip_html,
)
from apps.users.models import User


@pytest.fixture(autouse=True)
def ensure_fts_table(db):
    """Ensure the FTS5 virtual table exists for every test.

    This runs before test-specific fixtures (user, thread, etc.) that trigger
    post_save signals which write to the FTS table. The signals catch
    OperationalError, so even if ordering is surprising, no test will crash.
    Teardown clears the table for isolation between tests.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5("
            "title, body, "
            "type UNINDEXED, object_id UNINDEXED, "
            "url UNINDEXED, subtitle UNINDEXED, extra UNINDEXED, "
            "created_at UNINDEXED, "
            "tokenize='unicode61 remove_diacritics 2'"
            ")"
        )
    yield
    # Clean up after each test
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM search_index")


# =============================================================================
# Service Tests
# =============================================================================


class TestStripHtml:
    """Tests for HTML stripping."""

    def test_strip_basic_tags(self):
        """Test basic HTML tag removal."""
        result = strip_html("<p>Hello <b>World</b></p>")
        assert result == "Hello World"

    def test_strip_complex_tags(self):
        """Test complex nested HTML removal."""
        result = strip_html('<div class="test"><p>Hello</p><ul><li>Item 1</li></ul></div>')
        assert "Hello" in result
        assert "Item 1" in result
        assert "<" not in result

    def test_decode_entities(self):
        """Test HTML entity decoding."""
        result = strip_html("Hello &amp; World &lt;test&gt;")
        assert result == "Hello & World <test>"

    def test_empty_input(self):
        """Test empty input returns empty string."""
        assert strip_html("") == ""
        assert strip_html(None) == ""

    def test_normalize_whitespace(self):
        """Test whitespace normalization."""
        result = strip_html("<p>Hello</p>   <p>World</p>")
        assert "  " not in result


class TestCreateExcerpt:
    """Tests for excerpt creation."""

    def test_short_text_unchanged(self):
        """Test short text is not truncated."""
        result = create_excerpt("Hello", 100)
        assert result == "Hello"

    def test_long_text_truncated(self):
        """Test long text is truncated with ellipsis."""
        long_text = "This is a very long text that should be truncated"
        result = create_excerpt(long_text, 20)
        assert len(result) <= 20
        assert result.endswith("...")

    def test_html_stripped(self):
        """Test HTML is stripped before creating excerpt."""
        result = create_excerpt("<p>Hello <b>World</b></p>", 100)
        assert "<" not in result

    def test_empty_input(self):
        """Test empty input returns empty string."""
        assert create_excerpt("", 100) == ""


class TestBuildFtsQuery:
    """Tests for FTS5 query construction."""

    def test_single_word(self):
        """Test single word gets prefix matching."""
        result = build_fts_query("hello")
        assert result == '"hello"*'

    def test_multiple_words(self):
        """Test multiple words all get prefix matching."""
        result = build_fts_query("community meeting")
        assert result == '"community"* "meeting"*'

    def test_partial_word(self):
        """Test partial word for typeahead."""
        result = build_fts_query("comm mee")
        assert result == '"comm"* "mee"*'

    def test_special_characters_stripped(self):
        """Test FTS5 special characters are removed."""
        result = build_fts_query('hello "world" (test)')
        assert '"' not in result.replace('"hello"', "").replace('"world"', "").replace('"test"', "")

    def test_empty_query(self):
        """Test empty query returns empty string."""
        assert build_fts_query("") == ""
        assert build_fts_query("   ") == ""


class TestIndexAndSearch:
    """Tests for FTS5 index and search operations."""

    def test_index_and_find(self):
        """Test indexing an object and finding it via search."""
        index_object(
            obj_type="thread",
            object_id=1,
            title="Community Meeting Notes",
            body="Discussion about the garden project",
            url="/forum/general/1",
            subtitle="General",
        )
        results = fts_search("community")
        assert len(results) == 1
        assert results[0]["type"] == "thread"
        assert results[0]["object_id"] == 1

    def test_prefix_search(self):
        """Test prefix matching works for typeahead."""
        index_object(
            obj_type="user",
            object_id=1,
            title="Johannes Hansen",
            body="johannes@example.com",
            url="/profil/1",
        )
        results = fts_search("joha")
        assert len(results) == 1
        assert results[0]["title"] == "Johannes Hansen"

    def test_remove_object(self):
        """Test removing an object from the index."""
        index_object(
            obj_type="thread",
            object_id=42,
            title="Delete Me",
            body="This should be removed",
            url="/forum/test/42",
        )
        assert len(fts_search("Delete")) == 1
        remove_object("thread", 42)
        assert len(fts_search("Delete")) == 0

    def test_reindex_object(self):
        """Test re-indexing updates the object."""
        index_object(
            obj_type="thread",
            object_id=1,
            title="Old Title",
            body="old content",
            url="/forum/test/1",
        )
        index_object(
            obj_type="thread",
            object_id=1,
            title="New Title",
            body="new content",
            url="/forum/test/1",
        )
        assert len(fts_search("Old Title")) == 0
        assert len(fts_search("New Title")) == 1

    def test_extra_json(self):
        """Test extra field is stored and parsed as JSON."""
        index_object(
            obj_type="post",
            object_id=1,
            title="Thread Title",
            body="Post content",
            url="/forum/test/1",
            extra=json.dumps({"thread_id": 99}),
        )
        results = fts_search("Post content")
        assert results[0]["extra"] == {"thread_id": 99}

    def test_empty_search(self):
        """Test empty query returns no results."""
        assert fts_search("") == []

    def test_danish_characters(self):
        """Test Danish characters are searchable."""
        index_object(
            obj_type="thread",
            object_id=1,
            title="Fællesskab møde",
            body="Ærter og rødgrød",
            url="/forum/test/1",
        )
        # FTS5 with remove_diacritics should find these
        results = fts_search("Fællesskab")
        assert len(results) == 1

    def test_recency_boost(self):
        """Test newer documents rank higher than older ones with same relevance."""
        index_object(
            obj_type="thread",
            object_id=1,
            title="Generalforsamling",
            body="Referat fra generalforsamling",
            url="/forum/test/1",
            created_at="2020-01-01T00:00:00",
        )
        index_object(
            obj_type="thread",
            object_id=2,
            title="Generalforsamling",
            body="Referat fra generalforsamling",
            url="/forum/test/2",
            created_at="2025-12-01T00:00:00",
        )
        results = fts_search("Generalforsamling")
        assert len(results) == 2
        # The newer one (id=2) should come first
        assert results[0]["object_id"] == 2
        assert results[1]["object_id"] == 1

    def test_snippet_replaces_subtitle_for_content_types(self):
        """Test that fts_search returns a dynamic snippet as subtitle for content types."""
        index_object(
            obj_type="post",
            object_id=1,
            title="Tråd titel",
            body="Her er en lang tekst om haveprojektet med mange detaljer",
            url="/forum/test/1",
            subtitle="Statisk undertekst",
        )
        results = fts_search("haveprojektet")
        assert len(results) == 1
        # The subtitle should be the snippet (containing the matched term), not the static one
        assert "haveprojektet" in results[0]["subtitle"]

    def test_snippet_preserved_for_static_types(self):
        """Test that static types (users) keep their stored subtitle."""
        index_object(
            obj_type="user",
            object_id=1,
            title="Johannes Hansen",
            body="johannes@example.com",
            url="/profil/1",
            subtitle="Hus 5",
        )
        results = fts_search("Johannes")
        assert len(results) == 1
        # User subtitle should remain the static "Hus 5", not an email snippet
        assert results[0]["subtitle"] == "Hus 5"

    def test_content_types_decay_faster_than_static(self):
        """Test that threads/posts decay faster than users with the same age."""
        # A 3-year-old thread and a 3-year-old user with identical title
        index_object(
            obj_type="thread",
            object_id=1,
            title="Generalforsamling",
            body="",
            url="/forum/test/1",
            created_at="2023-01-01T00:00:00",
        )
        index_object(
            obj_type="user",
            object_id=2,
            title="Generalforsamling Hansen",
            body="",
            url="/profil/2",
            created_at="2023-01-01T00:00:00",
        )
        # A recent thread should beat both
        index_object(
            obj_type="thread",
            object_id=3,
            title="Generalforsamling",
            body="",
            url="/forum/test/3",
            created_at="2026-01-01T00:00:00",
        )
        results = fts_search("Generalforsamling")
        assert len(results) == 3
        # Recent thread first
        assert results[0]["object_id"] == 3


# =============================================================================
# API Tests
# =============================================================================


@pytest.mark.django_db(transaction=True)
class TestGlobalSearchAPI:
    """Tests for the Global Search API endpoint."""

    def test_search_requires_auth(self, api_client):
        """Test that search requires authentication."""
        response = api_client.get("/api/search/?q=test")
        assert response.status_code == 401

    def test_search_requires_query(self, authenticated_client):
        """Test that query parameter is required."""
        response = authenticated_client.get("/api/search/")
        assert response.status_code == 400
        assert "Query must be at least 2 characters" in str(response.data)

    def test_search_min_query_length(self, authenticated_client):
        """Test minimum query length validation."""
        response = authenticated_client.get("/api/search/?q=a")
        assert response.status_code == 400

    def test_search_returns_response_structure(self, authenticated_client):
        """Test search returns correct response structure."""
        response = authenticated_client.get("/api/search/?q=test")
        assert response.status_code == 200
        assert "query" in response.data
        assert "results" in response.data
        assert "total_count" in response.data
        assert response.data["query"] == "test"

    def test_search_returns_all_result_types(self, authenticated_client):
        """Test search returns all expected result types."""
        response = authenticated_client.get("/api/search/?q=test")
        assert response.status_code == 200

        results = response.data["results"]
        expected_types = [
            "users",
            "threads",
            "posts",
            "subgroups",
            "announcements",
            "events",
            "houses",
            "files",
        ]
        for result_type in expected_types:
            assert result_type in results

    def test_search_excludes_messages(self, authenticated_client):
        """Test that private messages are excluded from search."""
        response = authenticated_client.get("/api/search/?q=test")
        assert response.status_code == 200

        results = response.data["results"]
        assert "messages" not in results
        assert "conversations" not in results

    def test_search_finds_user_by_name(self, authenticated_client, user):
        """Test finding users via FTS5 and name heuristic."""
        index_object("user", user.id, "Test User", user.email, f"/profil/{user.id}")
        response = authenticated_client.get("/api/search/?q=Test User")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        assert len(users) >= 1
        assert any("Test User" in u["title"] for u in users)

    def test_search_finds_thread(self, authenticated_client, thread):
        """Test search finds threads by title."""
        index_object(
            "thread",
            thread.id,
            thread.title,
            "",
            f"/forum/{thread.subgroup.slug}/{thread.id}",
            thread.subgroup.name,
        )
        response = authenticated_client.get("/api/search/?q=Test Thread")
        assert response.status_code == 200

        threads = response.data["results"]["threads"]
        assert len(threads) >= 1
        assert any("Test Thread" in t["title"] for t in threads)

    def test_search_finds_post_content(self, authenticated_client, post):
        """Test search finds posts by content."""
        index_object(
            "post",
            post.id,
            post.thread.title,
            strip_html(post.content),
            f"/forum/{post.thread.subgroup.slug}/{post.thread.id}",
        )
        response = authenticated_client.get("/api/search/?q=test post content")
        assert response.status_code == 200

        posts = response.data["results"]["posts"]
        assert len(posts) >= 1

    def test_search_finds_subgroup(self, authenticated_client, subgroup):
        """Test search finds subgroups by name (via heuristic)."""
        response = authenticated_client.get("/api/search/?q=General Discussion")
        assert response.status_code == 200

        subgroups = response.data["results"]["subgroups"]
        assert len(subgroups) >= 1
        assert any("General Discussion" in s["title"] for s in subgroups)

    def test_search_finds_announcement(self, authenticated_client, user):
        """Test search finds announcements."""
        ann = Announcement.objects.create(
            title="Important Notice",
            content="This is an important announcement",
            author=user,
            is_active=True,
        )
        index_object("announcement", ann.id, ann.title, strip_html(ann.content), "/opslag")

        response = authenticated_client.get("/api/search/?q=Important Notice")
        assert response.status_code == 200

        announcements = response.data["results"]["announcements"]
        assert len(announcements) >= 1

    def test_search_finds_event(self, authenticated_client, user):
        """Test search finds calendar events."""
        from django.utils import timezone

        event = Event.objects.create(
            title="Community Meeting",
            description="Monthly community gathering",
            created_by=user,
            start_datetime=timezone.now(),
            end_datetime=timezone.now(),
        )
        index_object("event", event.id, event.title, event.description, "/kalender")

        response = authenticated_client.get("/api/search/?q=Community Meeting")
        assert response.status_code == 200

        events = response.data["results"]["events"]
        assert len(events) >= 1

    def test_search_finds_house(self, authenticated_client, house):
        """Test search finds houses."""
        index_object("house", house.id, house.name, house.description, f"/beboere/hus/{house.id}")
        response = authenticated_client.get("/api/search/?q=House")
        assert response.status_code == 200

        houses = response.data["results"]["houses"]
        assert len(houses) >= 1

    def test_search_limit_parameter(self, authenticated_client, user):
        """Test limit parameter restricts results."""
        for i in range(10):
            User.objects.create_user(
                email=f"searchtest{i}@example.com",
                password="test",
                first_name=f"SearchTest{i}",
                last_name="User",
            )

        response = authenticated_client.get("/api/search/?q=SearchTest&limit=3")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        assert len(users) <= 3

    def test_search_max_limit(self, authenticated_client):
        """Test limit parameter has a maximum."""
        response = authenticated_client.get("/api/search/?q=test&limit=100")
        assert response.status_code == 200
        # Should not error, limit is capped at 20

    def test_search_result_url_format(self, authenticated_client, thread, subgroup):
        """Test search results have correct URL format."""
        response = authenticated_client.get("/api/search/?q=Test Thread")
        assert response.status_code == 200

        threads = response.data["results"]["threads"]
        if threads:
            assert threads[0]["url"].startswith("/forum/")

        response2 = authenticated_client.get("/api/search/?q=General Discussion")
        subgroups = response2.data["results"]["subgroups"]
        if subgroups:
            assert subgroups[0]["url"].startswith("/forum/")

    def test_search_total_count(self, authenticated_client, user, thread, subgroup):
        """Test total_count is accurate."""
        response = authenticated_client.get("/api/search/?q=test")
        assert response.status_code == 200

        results = response.data["results"]
        expected_total = sum(len(v) for v in results.values())
        assert response.data["total_count"] == expected_total

    def test_search_only_active_users(self, db, authenticated_client):
        """Test search only returns active users."""
        User.objects.create_user(
            email="inactive@example.com",
            password="test",
            first_name="InactiveSpecialName",
            last_name="UserXyz",
            is_active=False,
        )

        response = authenticated_client.get("/api/search/?q=InactiveSpecialName")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        assert not any(u["title"] == "InactiveSpecialName UserXyz" for u in users)

    def test_search_only_active_announcements(self, authenticated_client, user):
        """Test search only returns active announcements."""
        Announcement.objects.create(
            title="HiddenAnnouncementXyz",
            content="This should not appear",
            author=user,
            is_active=False,
        )

        response = authenticated_client.get("/api/search/?q=HiddenAnnouncementXyz")
        assert response.status_code == 200

        announcements = response.data["results"]["announcements"]
        assert not any(a["title"] == "HiddenAnnouncementXyz" for a in announcements)

    # -- Heuristic-specific tests --

    def test_house_number_single_digit(self, authenticated_client, house):
        """Test 1-char digit query triggers house number heuristic."""
        response = authenticated_client.get("/api/search/?q=1")
        assert response.status_code == 200
        houses = response.data["results"]["houses"]
        assert len(houses) >= 1

    def test_house_number_with_residents(self, authenticated_client, user_with_house):
        """Test house number heuristic returns residents."""
        response = authenticated_client.get("/api/search/?q=1")
        assert response.status_code == 200
        users = response.data["results"]["users"]
        assert len(users) >= 1

    def test_house_number_out_of_range_rejected(self, authenticated_client):
        """Test that non-house-number single digits (>62) are rejected."""
        response = authenticated_client.get("/api/search/?q=0")
        assert response.status_code == 400

    def test_user_name_priority(self, authenticated_client, user):
        """Test user name istartswith heuristic injects matches at top."""
        response = authenticated_client.get("/api/search/?q=Te")
        assert response.status_code == 200
        users = response.data["results"]["users"]
        # The user fixture has first_name="Test", should match istartswith "Te"
        assert len(users) >= 1
        assert any("Test" in u["title"] for u in users)

    def test_search_returns_group_order(self, authenticated_client, user):
        """Test search response includes group_order for frontend sorting."""
        response = authenticated_client.get("/api/search/?q=Test")
        assert response.status_code == 200
        assert "group_order" in response.data
        # group_order should contain all known type keys
        for key in [
            "users",
            "threads",
            "posts",
            "subgroups",
            "announcements",
            "events",
            "houses",
            "files",
        ]:
            assert key in response.data["group_order"]

    def test_announcement_url_has_id(self, authenticated_client, user):
        """Test announcement search results include the ID in the URL for deep-linking."""
        ann = Announcement.objects.create(
            title="Deep Link Test Announcement",
            content="Testing deep link",
            author=user,
            is_active=True,
        )
        index_object(
            "announcement",
            ann.id,
            ann.title,
            strip_html(ann.content),
            f"/opslag#announcement-{ann.id}",
        )
        response = authenticated_client.get("/api/search/?q=Deep Link Test")
        assert response.status_code == 200
        announcements = response.data["results"]["announcements"]
        assert len(announcements) >= 1
        assert f"#announcement-{ann.id}" in announcements[0]["url"]

    def test_subgroup_name_injection(self, authenticated_client, subgroup):
        """Test subgroup icontains heuristic injects matches."""
        response = authenticated_client.get("/api/search/?q=General")
        assert response.status_code == 200
        subgroups = response.data["results"]["subgroups"]
        assert len(subgroups) >= 1
        assert any("General Discussion" in s["title"] for s in subgroups)


# =============================================================================
# Management Command Tests
# =============================================================================


@pytest.mark.django_db(transaction=True)
class TestRebuildSearchIndex:
    """Tests for the rebuild_search_index management command."""

    def test_rebuild_runs_successfully(self, user, house, subgroup, thread, post):
        """Test the command indexes all objects without errors."""
        from django.core.management import call_command

        call_command("rebuild_search_index")
        results = fts_search("Test")
        assert len(results) >= 1

    def test_rebuild_if_empty_skips_when_populated(self, user):
        """Test --if-empty skips rebuild when index has entries."""
        from io import StringIO

        from django.core.management import call_command

        call_command("rebuild_search_index")
        out = StringIO()
        call_command("rebuild_search_index", if_empty=True, stdout=out)
        assert "skipping rebuild" in out.getvalue()
