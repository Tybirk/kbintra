"""
Tests for the Announcements app.
"""

import pytest

from apps.announcements.models import Announcement


@pytest.fixture
def announcement(db, user):
    """Create a test announcement."""
    return Announcement.objects.create(
        title="Test Announcement",
        content="<p>This is a test announcement.</p>",
        author=user,
        priority=1,
    )


@pytest.fixture
def inactive_announcement(db, user):
    """Create an inactive announcement."""
    return Announcement.objects.create(
        title="Inactive Announcement",
        content="<p>This is inactive.</p>",
        author=user,
        is_active=False,
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestAnnouncementModel:
    """Tests for the Announcement model."""

    def test_announcement_str(self, announcement):
        """Test string representation of announcement."""
        assert str(announcement) == "Test Announcement"

    def test_announcement_ordering(self, db, user):
        """Test that announcements are ordered by priority and date."""
        low_priority = Announcement.objects.create(
            title="Low", content="test", author=user, priority=0
        )
        high_priority = Announcement.objects.create(
            title="High", content="test", author=user, priority=5
        )

        announcements = list(Announcement.objects.all())
        assert announcements[0] == high_priority
        assert announcements[1] == low_priority


# =============================================================================
# API Tests
# =============================================================================


class TestAnnouncementAPI:
    """Tests for the Announcement API endpoints."""

    def test_list_announcements_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list announcements."""
        response = api_client.get("/api/announcements/")
        assert response.status_code == 401

    def test_list_announcements(self, authenticated_client, announcement, inactive_announcement):
        """Test listing active announcements."""
        response = authenticated_client.get("/api/announcements/")
        assert response.status_code == 200

        # Should only show active announcements by default
        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Test Announcement"

    def test_list_all_announcements(
        self, authenticated_client, announcement, inactive_announcement
    ):
        """Test listing all announcements including inactive."""
        response = authenticated_client.get("/api/announcements/?is_active=false")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert results[0]["title"] == "Inactive Announcement"

    def test_create_announcement(self, authenticated_client):
        """Test creating an announcement."""
        response = authenticated_client.post(
            "/api/announcements/",
            {
                "title": "New Announcement",
                "content": "<p>New content</p>",
                "priority": 2,
            },
        )
        assert response.status_code == 201
        assert Announcement.objects.filter(title="New Announcement").exists()

    def test_get_announcement(self, authenticated_client, announcement):
        """Test getting a single announcement."""
        response = authenticated_client.get(f"/api/announcements/{announcement.id}/")
        assert response.status_code == 200
        assert response.json()["title"] == "Test Announcement"

    def test_update_own_announcement(self, authenticated_client, announcement):
        """Test updating own announcement."""
        response = authenticated_client.patch(
            f"/api/announcements/{announcement.id}/",
            {"title": "Updated Title"},
            format="json",
        )
        assert response.status_code == 200
        announcement.refresh_from_db()
        assert announcement.title == "Updated Title"

    def test_cannot_update_others_announcement(self, api_client, second_user, announcement):
        """Test that users cannot update others' announcements."""
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/announcements/{announcement.id}/",
            {"title": "Hacked Title"},
            format="json",
        )
        assert response.status_code == 403

    def test_delete_own_announcement(self, authenticated_client, announcement):
        """Test deleting own announcement."""
        response = authenticated_client.delete(f"/api/announcements/{announcement.id}/")
        assert response.status_code == 204
        assert not Announcement.objects.filter(id=announcement.id).exists()

    def test_cannot_delete_others_announcement(self, api_client, second_user, announcement):
        """Test that users cannot delete others' announcements."""
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/announcements/{announcement.id}/")
        assert response.status_code == 403


# =============================================================================
# Admin Rights Tests
# =============================================================================


class TestAnnouncementAdminRights:
    """Admin (is_staff) has no special privileges over announcements they did not author."""

    def test_admin_cannot_update_others_announcement(self, admin_client, announcement):
        """Admin cannot PATCH an announcement authored by another user."""
        original_title = announcement.title
        response = admin_client.patch(
            f"/api/announcements/{announcement.id}/",
            {"title": "Admin Updated Title"},
            format="json",
        )
        assert response.status_code == 403
        announcement.refresh_from_db()
        assert announcement.title == original_title

    def test_admin_cannot_delete_others_announcement(self, admin_client, announcement):
        """Admin cannot DELETE an announcement authored by another user."""
        announcement_id = announcement.id
        response = admin_client.delete(f"/api/announcements/{announcement_id}/")
        assert response.status_code == 403
        assert Announcement.objects.filter(id=announcement_id).exists()

    def test_admin_can_toggle_others_dashboard(self, admin_client, announcement):
        """Admin can toggle show_on_dashboard on another user's announcement."""
        announcement.show_on_dashboard = False
        announcement.save(update_fields=["show_on_dashboard"])
        response = admin_client.patch(
            f"/api/announcements/{announcement.id}/dashboard/",
            {"show_on_dashboard": True},
            format="json",
        )
        assert response.status_code == 200
        announcement.refresh_from_db()
        assert announcement.show_on_dashboard is True

    def test_non_admin_cannot_toggle_others_dashboard(self, api_client, second_user, announcement):
        """A non-author non-admin user cannot toggle dashboard visibility."""
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/announcements/{announcement.id}/dashboard/",
            {"show_on_dashboard": False},
            format="json",
        )
        assert response.status_code == 403
