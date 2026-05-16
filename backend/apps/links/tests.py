"""
Tests for the UsefulLinks app.
"""

from apps.links.models import UsefulLinks


class TestUsefulLinksAPI:
    """Tests for the Useful Links API endpoints."""

    def test_unauthenticated_returns_401(self, api_client):
        """Test that unauthenticated users cannot access links."""
        response = api_client.get("/api/links/")
        assert response.status_code == 401

    def test_get_links_returns_content(self, authenticated_client, db):
        """Test that authenticated users can get links content."""
        UsefulLinks.objects.create(pk=1, content="<p>Test content</p>")
        response = authenticated_client.get("/api/links/")
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "<p>Test content</p>"
        assert "updated_at" in data

    def test_get_creates_singleton_if_none_exists(self, authenticated_client, db):
        """Test that GET creates a singleton UsefulLinks object if none exists."""
        assert UsefulLinks.objects.count() == 0
        response = authenticated_client.get("/api/links/")
        assert response.status_code == 200
        assert UsefulLinks.objects.count() == 1

    def test_regular_user_can_put(self, authenticated_client, db):
        """Test that any authenticated user can update links."""
        response = authenticated_client.put(
            "/api/links/", {"content": "<p>new content</p>"}, format="json"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "<p>new content</p>"

    def test_admin_can_update_content(self, admin_client, db):
        """Test that admin users can update links."""
        response = admin_client.put(
            "/api/links/", {"content": "<p>Updated content</p>"}, format="json"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "<p>Updated content</p>"

    def test_updated_by_set_on_put(self, admin_client, admin_user, db):
        """Test that updated_by is set to the requesting user on PUT."""
        admin_client.put("/api/links/", {"content": "some content"}, format="json")
        links = UsefulLinks.objects.get(pk=1)
        assert links.updated_by == admin_user

    def test_put_rejects_null_content(self, admin_client, db):
        """Test that PUT rejects null content."""
        response = admin_client.put("/api/links/", {"content": None}, format="json")
        assert response.status_code == 400
