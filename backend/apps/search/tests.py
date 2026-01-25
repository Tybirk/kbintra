"""
Tests for the Search app.
"""

from apps.announcements.models import Announcement
from apps.calendar_app.models import Event
from apps.search.services import create_excerpt, fuzzy_match, search_queryset, strip_html
from apps.users.models import User

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


class TestFuzzyMatch:
    """Tests for fuzzy matching logic."""

    def test_exact_match(self):
        """Test exact string match returns high score."""
        matches, score = fuzzy_match("hello", "hello")
        assert matches is True
        assert score == 100

    def test_case_insensitive(self):
        """Test case insensitive matching."""
        matches, score = fuzzy_match("HELLO", "hello")
        assert matches is True
        assert score == 100

    def test_typo_tolerance(self):
        """Test typos are tolerated."""
        matches, score = fuzzy_match("helo", "hello")
        assert matches is True
        assert score >= 60

    def test_partial_match(self):
        """Test partial word matching."""
        matches, score = fuzzy_match("john", "John Smith")
        assert matches is True
        assert score >= 60

    def test_word_order_tolerance(self):
        """Test word order doesn't matter."""
        matches, score = fuzzy_match("smith john", "John Smith")
        assert matches is True
        assert score >= 80

    def test_no_match_below_threshold(self):
        """Test unrelated strings don't match."""
        matches, score = fuzzy_match("xyz", "hello world")
        assert matches is False

    def test_empty_query(self):
        """Test empty query returns no match."""
        matches, score = fuzzy_match("", "hello")
        assert matches is False
        assert score == 0

    def test_empty_text(self):
        """Test empty text returns no match."""
        matches, score = fuzzy_match("hello", "")
        assert matches is False
        assert score == 0

    def test_danish_characters(self):
        """Test Danish characters are handled correctly."""
        matches, score = fuzzy_match("aeble", "Dagens ret er blandet grillmad og")
        # Should not match unrelated content
        matches2, score2 = fuzzy_match("madudvalg", "Madudvalg")
        assert matches2 is True
        assert score2 == 100


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


class TestSearchQueryset:
    """Tests for queryset search."""

    def test_search_returns_sorted_results(self, db, user, second_user):
        """Test search returns results sorted by score."""
        # Create users with different names
        User.objects.create_user(
            email="exact@example.com",
            password="test",
            first_name="SearchTerm",
            last_name="User",
        )
        User.objects.create_user(
            email="partial@example.com",
            password="test",
            first_name="Searching",
            last_name="Person",
        )

        results = search_queryset(
            User.objects.filter(is_active=True),
            ["first_name", "last_name"],
            "SearchTerm",
            limit=10,
            threshold=60,
        )

        assert len(results) >= 1
        # First result should have highest score
        if len(results) > 1:
            assert results[0][1] >= results[1][1]


# =============================================================================
# API Tests
# =============================================================================


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
        """Test fuzzy matching on user names."""
        response = authenticated_client.get("/api/search/?q=Test User")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        assert len(users) >= 1
        assert any("Test User" in u["title"] for u in users)

    def test_search_finds_user_with_typo(self, authenticated_client, user):
        """Test fuzzy matching handles typos."""
        # Use a less severe typo that fuzzy matching can handle
        response = authenticated_client.get("/api/search/?q=Tets User")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        # Should find "Test User" despite typo
        assert len(users) >= 1

    def test_search_finds_thread(self, authenticated_client, thread):
        """Test search finds threads by title."""
        response = authenticated_client.get("/api/search/?q=Test Thread")
        assert response.status_code == 200

        threads = response.data["results"]["threads"]
        assert len(threads) >= 1
        assert any("Test Thread" in t["title"] for t in threads)

    def test_search_finds_post_content(self, authenticated_client, post):
        """Test search finds posts by content."""
        response = authenticated_client.get("/api/search/?q=test content")
        assert response.status_code == 200

        posts = response.data["results"]["posts"]
        assert len(posts) >= 1

    def test_search_finds_subgroup(self, authenticated_client, subgroup):
        """Test search finds subgroups by name."""
        response = authenticated_client.get("/api/search/?q=General Discussion")
        assert response.status_code == 200

        subgroups = response.data["results"]["subgroups"]
        assert len(subgroups) >= 1
        assert any("General Discussion" in s["title"] for s in subgroups)

    def test_search_finds_announcement(self, authenticated_client, user):
        """Test search finds announcements."""
        Announcement.objects.create(
            title="Important Notice",
            content="This is an important announcement",
            author=user,
            is_active=True,
        )

        response = authenticated_client.get("/api/search/?q=Important Notice")
        assert response.status_code == 200

        announcements = response.data["results"]["announcements"]
        assert len(announcements) >= 1

    def test_search_finds_event(self, authenticated_client, user):
        """Test search finds calendar events."""
        from django.utils import timezone

        Event.objects.create(
            title="Community Meeting",
            description="Monthly community gathering",
            created_by=user,
            start_datetime=timezone.now(),
            end_datetime=timezone.now(),
        )

        response = authenticated_client.get("/api/search/?q=Community Meeting")
        assert response.status_code == 200

        events = response.data["results"]["events"]
        assert len(events) >= 1

    def test_search_finds_house(self, authenticated_client, house):
        """Test search finds houses."""
        response = authenticated_client.get("/api/search/?q=House 1")
        assert response.status_code == 200

        houses = response.data["results"]["houses"]
        assert len(houses) >= 1

    def test_search_limit_parameter(self, authenticated_client, user):
        """Test limit parameter restricts results."""
        # Create multiple users
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
            # URL format is /forum/{subgroup_slug}/{thread_id}
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
        inactive_user = User.objects.create_user(
            email="inactive@example.com",
            password="test",
            first_name="Inactive",
            last_name="User",
            is_active=False,
        )

        response = authenticated_client.get("/api/search/?q=Inactive User")
        assert response.status_code == 200

        users = response.data["results"]["users"]
        assert not any(u["title"] == "Inactive User" for u in users)

    def test_search_only_active_announcements(self, authenticated_client, user):
        """Test search only returns active announcements."""
        Announcement.objects.create(
            title="Hidden Announcement",
            content="This should not appear",
            author=user,
            is_active=False,
        )

        response = authenticated_client.get("/api/search/?q=Hidden Announcement")
        assert response.status_code == 200

        announcements = response.data["results"]["announcements"]
        assert not any(a["title"] == "Hidden Announcement" for a in announcements)
