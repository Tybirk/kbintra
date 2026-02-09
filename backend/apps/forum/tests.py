"""
Tests for the Forum app.
"""

import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.forum.models import (
    File,
    Folder,
    Poll,
    PollOption,
    PollVote,
    Post,
    Subgroup,
    SubgroupSubscription,
    Thread,
)


def get_results(response_data):
    """Helper to extract results from paginated or non-paginated response."""
    if isinstance(response_data, dict) and "results" in response_data:
        return response_data["results"]
    return response_data


# =============================================================================
# Model Tests
# =============================================================================


class TestSubgroupModel:
    """Tests for the Subgroup model."""

    def test_subgroup_str(self, subgroup):
        """Test string representation of subgroup."""
        assert str(subgroup) == "General Discussion"

    def test_subgroup_auto_slug(self, db):
        """Test that slug is auto-generated from name."""
        subgroup = Subgroup.objects.create(name="Test Subgroup")
        assert subgroup.slug == "test-subgroup"

    def test_subgroup_ordering_committees_first(self, db):
        """Test that committees appear before regular subgroups."""
        regular = Subgroup.objects.create(name="Regular", is_committee=False)
        committee = Subgroup.objects.create(name="Committee", is_committee=True)

        subgroups = list(Subgroup.objects.all())
        assert subgroups[0] == committee
        assert subgroups[1] == regular

    def test_subgroup_last_activity_updated_on_thread_create(self, authenticated_client, subgroup):
        """Test that last_activity_at is updated when a thread is created."""
        old_activity = subgroup.last_activity_at

        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "New Thread", "content": "Test content"},
        )
        assert response.status_code == 201

        subgroup.refresh_from_db()
        assert subgroup.last_activity_at is not None
        if old_activity:
            assert subgroup.last_activity_at >= old_activity


class TestSubgroupSubscriptionModel:
    """Tests for the SubgroupSubscription model."""

    def test_subscription_str(self, subgroup_subscription):
        """Test string representation of subscription."""
        assert "Test User" in str(subgroup_subscription)
        assert "General Discussion" in str(subgroup_subscription)

    def test_subscription_unique_together(self, db, user, subgroup):
        """Test that a user can only subscribe once to a subgroup."""
        from django.db import IntegrityError

        SubgroupSubscription.objects.create(user=user, subgroup=subgroup)
        with pytest.raises(IntegrityError):
            SubgroupSubscription.objects.create(user=user, subgroup=subgroup)


class TestThreadModel:
    """Tests for the Thread model."""

    def test_thread_str(self, thread):
        """Test string representation of thread."""
        assert str(thread) == "Test Thread"

    def test_thread_ordering_pinned_first(self, db, user, subgroup):
        """Test that pinned threads appear first."""
        Thread.objects.create(subgroup=subgroup, title="Regular", author=user)
        pinned = Thread.objects.create(
            subgroup=subgroup, title="Pinned", author=user, is_pinned=True
        )

        threads = list(Thread.objects.filter(subgroup=subgroup))
        assert threads[0] == pinned


class TestPostModel:
    """Tests for the Post model."""

    def test_post_str(self, post):
        """Test string representation of post."""
        assert "Test User" in str(post)
        assert "Test Thread" in str(post)

    def test_post_ordering_by_created_at(self, db, user, thread):
        """Test that posts are ordered by creation time."""
        post1 = Post.objects.create(thread=thread, author=user, content="First")
        post2 = Post.objects.create(thread=thread, author=user, content="Second")

        posts = list(Post.objects.filter(thread=thread))
        assert posts[0] == post1
        assert posts[1] == post2


class TestFolderModel:
    """Tests for the Folder model."""

    def test_folder_str(self, folder):
        """Test string representation of folder."""
        assert str(folder) == "Test Folder"

    def test_folder_with_parent(self, subfolder, folder):
        """Test subfolder has parent."""
        assert subfolder.parent == folder

    def test_folder_unique_together_prevents_duplicate(self, db, subgroup, folder):
        """Test folder name uniqueness within parent (model-level validation)."""
        # The unique_together constraint is enforced at database level
        # We can verify the constraint exists by checking the model meta
        unique_together = Folder._meta.unique_together
        assert ("subgroup", "parent", "name") in unique_together


class TestFileModel:
    """Tests for the File model."""

    def test_file_str(self, db, user, subgroup):
        """Test string representation of file."""
        file = File.objects.create(
            subgroup=subgroup,
            uploaded_by=user,
            file=SimpleUploadedFile("test.txt", b"content"),
            name="test.txt",
        )
        assert str(file) == "test.txt"

    def test_file_at_root_level(self, db, user, subgroup):
        """Test file can be at root level (no folder)."""
        file = File.objects.create(
            subgroup=subgroup,
            uploaded_by=user,
            file=SimpleUploadedFile("root.txt", b"content"),
            name="root.txt",
            folder=None,
        )
        assert file.folder is None
        assert file.subgroup == subgroup


# =============================================================================
# Serializer Tests
# =============================================================================


class TestSubgroupSerializer:
    """Tests for the SubgroupSerializer."""

    def test_subgroup_serializer_includes_thread_count(
        self, authenticated_client, subgroup, thread
    ):
        """Test that thread_count is calculated correctly."""
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["thread_count"] == 1

    def test_subgroup_serializer_includes_is_subscribed(
        self, authenticated_client, subgroup, subgroup_subscription
    ):
        """Test that is_subscribed is calculated correctly."""
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["is_subscribed"] is True


class TestThreadSerializer:
    """Tests for the ThreadSerializer."""

    def test_thread_serializer_includes_post_count(self, authenticated_client, thread, post):
        """Test that post_count is calculated correctly."""
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        assert len(response.data["posts"]) == 1


class TestPostSerializer:
    """Tests for the PostSerializer."""

    def test_post_serializer_includes_is_own(self, authenticated_client, post):
        """Test that is_own is calculated correctly for owner."""
        response = authenticated_client.get(f"/api/forum/threads/{post.thread.id}/")
        assert response.status_code == 200
        assert response.data["posts"][0]["is_own"] is True


# =============================================================================
# View Tests
# =============================================================================


class TestSubgroupViews:
    """Tests for subgroup views."""

    def test_list_subgroups(self, authenticated_client, subgroup):
        """Test listing all subgroups."""
        response = authenticated_client.get("/api/forum/subgroups/")
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_list_subgroups_unauthenticated(self, api_client, subgroup):
        """Test that unauthenticated users cannot list subgroups."""
        response = api_client.get("/api/forum/subgroups/")
        assert response.status_code == 401

    def test_get_subgroup_detail(self, authenticated_client, subgroup):
        """Test getting subgroup detail by slug."""
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["name"] == "General Discussion"


class TestSubscriptionViews:
    """Tests for subscription views."""

    def test_subscribe_to_subgroup(self, authenticated_client, subgroup):
        """Test subscribing to a subgroup."""
        response = authenticated_client.post(f"/api/forum/subgroups/{subgroup.slug}/subscribe/")
        assert response.status_code == 201
        assert "subscribed" in response.data["detail"].lower()

    def test_subscribe_already_subscribed(
        self, authenticated_client, subgroup, subgroup_subscription
    ):
        """Test subscribing when already subscribed."""
        response = authenticated_client.post(f"/api/forum/subgroups/{subgroup.slug}/subscribe/")
        assert response.status_code == 200
        assert "already" in response.data["detail"].lower()

    def test_unsubscribe_from_subgroup(self, authenticated_client, subgroup, subgroup_subscription):
        """Test unsubscribing from a subgroup."""
        response = authenticated_client.post(f"/api/forum/subgroups/{subgroup.slug}/unsubscribe/")
        assert response.status_code == 200
        assert "unsubscribed" in response.data["detail"].lower()

    def test_unsubscribe_not_subscribed(self, authenticated_client, subgroup):
        """Test unsubscribing when not subscribed."""
        response = authenticated_client.post(f"/api/forum/subgroups/{subgroup.slug}/unsubscribe/")
        assert response.status_code == 200
        assert "not subscribed" in response.data["detail"].lower()

    def test_get_my_subscriptions(self, authenticated_client, subgroup_subscription):
        """Test getting user's subscriptions."""
        response = authenticated_client.get("/api/forum/subscriptions/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1


class TestThreadViews:
    """Tests for thread views."""

    def test_list_threads(self, authenticated_client, subgroup, thread):
        """Test listing threads in a subgroup."""
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/threads/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_create_thread(self, authenticated_client, subgroup):
        """Test creating a new thread."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "New Thread", "content": "Initial post content"},
        )
        assert response.status_code == 201
        assert Thread.objects.filter(title="New Thread").exists()
        # Check that initial post was created
        thread = Thread.objects.get(title="New Thread")
        assert thread.posts.count() == 1

    def test_get_thread_detail(self, authenticated_client, thread, post):
        """Test getting thread detail with posts."""
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        assert response.data["title"] == "Test Thread"
        assert len(response.data["posts"]) == 1

    def test_delete_thread_owner(self, authenticated_client, thread):
        """Test that thread owner can delete thread."""
        response = authenticated_client.delete(f"/api/forum/threads/{thread.id}/delete/")
        assert response.status_code == 204
        assert not Thread.objects.filter(id=thread.id).exists()

    def test_delete_thread_not_owner(self, api_client, second_user, thread):
        """Test that non-owner cannot delete thread."""
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/forum/threads/{thread.id}/delete/")
        assert response.status_code == 403


class TestThreadCloseViews:
    """Tests for thread close/reopen functionality."""

    def test_owner_can_close_thread(self, authenticated_client, thread):
        """Test that thread owner can close their thread."""
        response = authenticated_client.post(f"/api/forum/threads/{thread.id}/close/")
        assert response.status_code == 200
        assert response.data["is_closed"] is True
        thread.refresh_from_db()
        assert thread.is_closed is True

    def test_owner_can_reopen_thread(self, authenticated_client, thread):
        """Test that thread owner can reopen their closed thread."""
        thread.is_closed = True
        thread.save()

        response = authenticated_client.post(f"/api/forum/threads/{thread.id}/close/")
        assert response.status_code == 200
        assert response.data["is_closed"] is False
        thread.refresh_from_db()
        assert thread.is_closed is False

    def test_admin_can_close_thread(self, api_client, admin_user, thread):
        """Test that admin can close any thread."""
        api_client.force_authenticate(user=admin_user)
        response = api_client.post(f"/api/forum/threads/{thread.id}/close/")
        assert response.status_code == 200
        assert response.data["is_closed"] is True

    def test_non_owner_cannot_close_thread(self, api_client, second_user, thread):
        """Test that non-owner cannot close thread."""
        api_client.force_authenticate(user=second_user)
        response = api_client.post(f"/api/forum/threads/{thread.id}/close/")
        assert response.status_code == 403

    def test_explicit_close_value(self, authenticated_client, thread):
        """Test that explicit is_closed value can be passed."""
        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/close/",
            {"is_closed": True},
        )
        assert response.status_code == 200
        assert response.data["is_closed"] is True

    def test_cannot_post_to_closed_thread(self, authenticated_client, thread):
        """Test that posting to a closed thread is rejected."""
        thread.is_closed = True
        thread.save()

        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            {"content": "This should fail"},
        )
        assert response.status_code == 403
        assert "lukket" in response.data["detail"].lower()

    def test_thread_detail_includes_closed_status(self, authenticated_client, thread):
        """Test that thread detail includes is_closed and can_close fields."""
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        assert "is_closed" in response.data
        assert "can_close" in response.data
        assert response.data["is_closed"] is False
        assert response.data["can_close"] is True  # Owner can close

    def test_thread_list_includes_closed_status(self, authenticated_client, subgroup, thread):
        """Test that thread list includes is_closed field."""
        thread.is_closed = True
        thread.save()

        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/threads/")
        assert response.status_code == 200
        threads = get_results(response.data)
        assert len(threads) == 1
        assert threads[0]["is_closed"] is True


class TestPostViews:
    """Tests for post views."""

    def test_list_posts(self, authenticated_client, thread, post):
        """Test listing posts in a thread."""
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/posts/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_create_post(self, authenticated_client, thread):
        """Test creating a new post."""
        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            {"content": "New post content"},
        )
        assert response.status_code == 201
        assert Post.objects.filter(content="New post content").exists()

    def test_update_post_owner(self, authenticated_client, post):
        """Test that post owner can update post."""
        response = authenticated_client.patch(
            f"/api/forum/posts/{post.id}/",
            {"content": "Updated content"},
        )
        assert response.status_code == 200
        post.refresh_from_db()
        assert post.content == "Updated content"

    def test_update_post_not_owner(self, api_client, second_user, post):
        """Test that non-owner cannot update post."""
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/forum/posts/{post.id}/",
            {"content": "Hacked content"},
        )
        assert response.status_code == 403

    def test_delete_post_owner(self, authenticated_client, post):
        """Test that post owner can delete post."""
        post_id = post.id
        response = authenticated_client.delete(f"/api/forum/posts/{post.id}/")
        assert response.status_code == 204
        assert not Post.objects.filter(id=post_id).exists()

    def test_create_post_thread_author_deleted(self, api_client, second_user, subgroup, user):
        """Test creating a post when thread author has been deleted.

        This tests the fix for the NoneType error when thread.author is None.
        The notification system should handle this gracefully.
        """
        # Create thread as first user
        api_client.force_authenticate(user=user)
        response = api_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Thread by deleted user", "content": "Initial content"},
        )
        assert response.status_code == 201
        thread = Thread.objects.get(title="Thread by deleted user")

        # Delete the thread author (simulating user deletion with SET_NULL)
        thread.author = None
        thread.save()

        # Second user replies to thread - should not crash
        api_client.force_authenticate(user=second_user)
        response = api_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            {"content": "Reply to orphaned thread"},
        )
        assert response.status_code == 201
        assert Post.objects.filter(content="Reply to orphaned thread").exists()


class TestFolderViews:
    """Tests for folder views."""

    def test_list_folders(self, authenticated_client, subgroup, folder):
        """Test listing folders in a subgroup."""
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/folders/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_list_subfolders(self, authenticated_client, subgroup, folder, subfolder):
        """Test listing subfolders with parent parameter."""
        response = authenticated_client.get(
            f"/api/forum/subgroups/{subgroup.slug}/folders/?parent={folder.id}"
        )
        assert response.status_code == 200
        results = get_results(response.data)
        assert len(results) == 1
        assert results[0]["name"] == "Test Subfolder"

    def test_create_folder(self, authenticated_client, subgroup):
        """Test creating a new folder."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": "New Folder"},
        )
        assert response.status_code == 201
        assert Folder.objects.filter(name="New Folder").exists()

    def test_create_subfolder(self, authenticated_client, subgroup, folder):
        """Test creating a subfolder."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": "New Subfolder", "parent": folder.id},
        )
        assert response.status_code == 201
        new_folder = Folder.objects.get(name="New Subfolder")
        assert new_folder.parent == folder


class TestFileViews:
    """Tests for file views."""

    def test_list_files_in_folder(self, authenticated_client, user, subgroup, folder):
        """Test listing files in a folder."""
        File.objects.create(
            subgroup=subgroup,
            folder=folder,
            uploaded_by=user,
            file=SimpleUploadedFile("test.txt", b"content"),
            name="test.txt",
        )
        response = authenticated_client.get(f"/api/forum/folders/{folder.id}/files/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_list_root_files(self, authenticated_client, user, subgroup):
        """Test listing files at root level."""
        File.objects.create(
            subgroup=subgroup,
            folder=None,
            uploaded_by=user,
            file=SimpleUploadedFile("root.txt", b"content"),
            name="root.txt",
        )
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/files/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_upload_file_to_folder(self, authenticated_client, subgroup, folder):
        """Test uploading a file to a folder."""
        test_file = SimpleUploadedFile("upload.txt", b"file content")
        response = authenticated_client.post(
            f"/api/forum/folders/{folder.id}/files/",
            {"file": test_file},
            format="multipart",
        )
        assert response.status_code == 201
        assert File.objects.filter(folder=folder).exists()

    def test_upload_file_to_root(self, authenticated_client, subgroup):
        """Test uploading a file to root level."""
        test_file = SimpleUploadedFile("root_upload.txt", b"file content")
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/files/",
            {"file": test_file},
            format="multipart",
        )
        assert response.status_code == 201
        assert File.objects.filter(subgroup=subgroup, folder=None).exists()

    def test_upload_file_uses_original_name_if_not_provided(self, authenticated_client, subgroup):
        """Test that original filename is used if name not provided."""
        test_file = SimpleUploadedFile("original_name.txt", b"content")
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/files/",
            {"file": test_file},
            format="multipart",
        )
        assert response.status_code == 201
        file = File.objects.get(subgroup=subgroup, folder=None)
        assert file.name == "original_name.txt"

    def test_delete_file_owner(self, authenticated_client, user, subgroup):
        """Test that file owner can delete file."""
        file = File.objects.create(
            subgroup=subgroup,
            uploaded_by=user,
            file=SimpleUploadedFile("delete.txt", b"content"),
            name="delete.txt",
        )
        response = authenticated_client.delete(f"/api/forum/files/{file.id}/")
        assert response.status_code == 204
        assert not File.objects.filter(id=file.id).exists()

    def test_delete_file_not_owner(self, api_client, second_user, user, subgroup):
        """Test that non-owner cannot delete file."""
        file = File.objects.create(
            subgroup=subgroup,
            uploaded_by=user,
            file=SimpleUploadedFile("protected.txt", b"content"),
            name="protected.txt",
        )
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/forum/files/{file.id}/")
        assert response.status_code == 403


class TestFileMoveViews:
    """Tests for file move functionality."""

    def test_move_file_to_folder(self, authenticated_client, user, subgroup, folder):
        """Test moving a file to a folder."""
        file = File.objects.create(
            subgroup=subgroup,
            folder=None,
            uploaded_by=user,
            file=SimpleUploadedFile("movable.txt", b"content"),
            name="movable.txt",
        )
        response = authenticated_client.patch(
            f"/api/forum/files/{file.id}/move/",
            {"folder_id": folder.id},
        )
        assert response.status_code == 200
        file.refresh_from_db()
        assert file.folder == folder

    def test_move_file_to_root(self, authenticated_client, user, subgroup, folder):
        """Test moving a file to root level."""
        file = File.objects.create(
            subgroup=subgroup,
            folder=folder,
            uploaded_by=user,
            file=SimpleUploadedFile("to_root.txt", b"content"),
            name="to_root.txt",
        )
        response = authenticated_client.patch(
            f"/api/forum/files/{file.id}/move/",
            {"folder_id": None},
            format="json",
        )
        assert response.status_code == 200
        file.refresh_from_db()
        assert file.folder is None

    def test_move_file_not_owner(self, api_client, second_user, user, subgroup, folder):
        """Test that non-owner cannot move file."""
        file = File.objects.create(
            subgroup=subgroup,
            folder=None,
            uploaded_by=user,
            file=SimpleUploadedFile("locked.txt", b"content"),
            name="locked.txt",
        )
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/forum/files/{file.id}/move/",
            {"folder_id": folder.id},
        )
        assert response.status_code == 403

    def test_move_file_admin_can_move(self, admin_client, user, subgroup, folder):
        """Test that admin can move any file."""
        file = File.objects.create(
            subgroup=subgroup,
            folder=None,
            uploaded_by=user,
            file=SimpleUploadedFile("admin_move.txt", b"content"),
            name="admin_move.txt",
        )
        response = admin_client.patch(
            f"/api/forum/files/{file.id}/move/",
            {"folder_id": folder.id},
        )
        assert response.status_code == 200
        file.refresh_from_db()
        assert file.folder == folder

    def test_move_file_to_different_subgroup_fails(
        self, authenticated_client, user, subgroup, committee_subgroup
    ):
        """Test that moving a file to a folder in a different subgroup fails."""
        other_folder = Folder.objects.create(
            subgroup=committee_subgroup,
            name="Other Folder",
        )
        file = File.objects.create(
            subgroup=subgroup,
            folder=None,
            uploaded_by=user,
            file=SimpleUploadedFile("cross_group.txt", b"content"),
            name="cross_group.txt",
        )
        response = authenticated_client.patch(
            f"/api/forum/files/{file.id}/move/",
            {"folder_id": other_folder.id},
        )
        assert response.status_code == 400
        assert "different subgroup" in response.data["detail"].lower()


# =============================================================================
# Recent Activity Tests
# =============================================================================


class TestRecentActivityView:
    """Tests for the Recent Activity API endpoint."""

    def test_recent_activity_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot access recent activity."""
        response = api_client.get("/api/forum/recent/")
        assert response.status_code == 401

    def test_recent_activity_empty(self, authenticated_client):
        """Test recent activity when no posts exist."""
        response = authenticated_client.get("/api/forum/recent/")
        assert response.status_code == 200
        assert response.data == []

    def test_recent_activity_returns_posts(self, authenticated_client, subgroup):
        """Test recent activity returns posts with thread/subgroup context."""
        # Create a thread with initial post
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Test Thread", "content": "Test post content"},
        )
        assert response.status_code == 201

        # Get recent activity
        response = authenticated_client.get("/api/forum/recent/")
        assert response.status_code == 200
        assert len(response.data) == 1

        activity = response.data[0]
        assert "author" in activity
        assert activity["thread_title"] == "Test Thread"
        assert activity["subgroup_slug"] == subgroup.slug
        assert activity["subgroup_name"] == subgroup.name
        assert "content" in activity
        assert "created_at" in activity

    def test_recent_activity_ordered_by_newest_first(self, authenticated_client, subgroup):
        """Test that recent activity is ordered by newest first."""
        # Create first thread
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "First Thread", "content": "First content"},
        )
        assert response.status_code == 201
        thread = Thread.objects.get(title="First Thread")

        # Add a reply
        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            {"content": "Second post - reply"},
        )
        assert response.status_code == 201

        # Get recent activity
        response = authenticated_client.get("/api/forum/recent/")
        assert response.status_code == 200
        assert len(response.data) == 2

        # Newest should be first
        assert "Second post" in response.data[0]["content"]
        assert "First content" in response.data[1]["content"]

    def test_recent_activity_limit_parameter(self, authenticated_client, subgroup):
        """Test that limit parameter works."""
        # Create a thread
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Thread", "content": "Initial post"},
        )
        assert response.status_code == 201
        thread = Thread.objects.get(title="Thread")

        # Add more replies
        for i in range(5):
            authenticated_client.post(
                f"/api/forum/threads/{thread.id}/posts/",
                {"content": f"Reply {i}"},
            )

        # Test default limit
        response = authenticated_client.get("/api/forum/recent/")
        assert response.status_code == 200
        assert len(response.data) == 6  # 1 initial + 5 replies

        # Test custom limit
        response = authenticated_client.get("/api/forum/recent/?limit=3")
        assert response.status_code == 200
        assert len(response.data) == 3

    def test_recent_activity_invalid_limit_parameter(self, authenticated_client, subgroup):
        """Test that invalid limit parameter is handled gracefully."""
        # Create a thread with initial post
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Test Thread", "content": "Test content"},
        )
        assert response.status_code == 201

        # Test with invalid limit (non-numeric)
        response = authenticated_client.get("/api/forum/recent/?limit=abc")
        assert response.status_code == 200  # Should not crash, defaults to 10

        # Test with negative limit (should be clamped to 1)
        response = authenticated_client.get("/api/forum/recent/?limit=-5")
        assert response.status_code == 200

        # Test with limit over max (should be clamped to 50)
        response = authenticated_client.get("/api/forum/recent/?limit=100")
        assert response.status_code == 200

    def test_recent_activity_across_subgroups(self, authenticated_client, subgroup, db):
        """Test that recent activity includes posts from all subgroups."""
        # Create another subgroup
        other_subgroup = Subgroup.objects.create(name="Other Subgroup")

        # Create thread in first subgroup
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Thread in first", "content": "Content in first"},
        )
        assert response.status_code == 201

        # Create thread in second subgroup
        response = authenticated_client.post(
            f"/api/forum/subgroups/{other_subgroup.slug}/threads/",
            {"title": "Thread in second", "content": "Content in second"},
        )
        assert response.status_code == 201

        # Get recent activity
        response = authenticated_client.get("/api/forum/recent/")
        assert response.status_code == 200
        assert len(response.data) == 2

        # Both subgroups should be represented
        subgroup_names = {item["subgroup_name"] for item in response.data}
        assert subgroup.name in subgroup_names
        assert other_subgroup.name in subgroup_names


# =============================================================================
# Integration Tests
# =============================================================================


class TestForumIntegration:
    """Integration tests for the forum feature."""

    def test_full_thread_lifecycle(self, authenticated_client, subgroup):
        """Test creating a thread, adding posts, and deleting."""
        # Create thread
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "Integration Test Thread", "content": "First post"},
        )
        assert response.status_code == 201
        thread_id = Thread.objects.get(title="Integration Test Thread").id

        # Add a reply
        response = authenticated_client.post(
            f"/api/forum/threads/{thread_id}/posts/",
            {"content": "Reply post"},
        )
        assert response.status_code == 201

        # Get thread with posts
        response = authenticated_client.get(f"/api/forum/threads/{thread_id}/")
        assert response.status_code == 200
        assert len(response.data["posts"]) == 2

        # Delete thread
        response = authenticated_client.delete(f"/api/forum/threads/{thread_id}/delete/")
        assert response.status_code == 204

    def test_folder_file_management(self, authenticated_client, subgroup):
        """Test creating folders and managing files."""
        # Create folder
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": "Documents"},
        )
        assert response.status_code == 201
        folder_id = Folder.objects.get(name="Documents").id

        # Upload file to folder
        test_file = SimpleUploadedFile("doc.txt", b"document content")
        response = authenticated_client.post(
            f"/api/forum/folders/{folder_id}/files/",
            {"file": test_file, "name": "Important Document"},
            format="multipart",
        )
        assert response.status_code == 201

        # List files in folder
        response = authenticated_client.get(f"/api/forum/folders/{folder_id}/files/")
        assert response.status_code == 200
        results = get_results(response.data)
        assert len(results) == 1
        assert results[0]["name"] == "Important Document"


# =============================================================================
# Poll Tests
# =============================================================================


@pytest.fixture
def poll(db, user, post):
    """Create a test poll on a post."""
    poll = Poll.objects.create(
        post=post,
        question="What is your favorite color?",
        allow_multiple_votes=False,
        is_anonymous=False,
        created_by=user,
    )
    PollOption.objects.create(poll=poll, text="Red", order=0)
    PollOption.objects.create(poll=poll, text="Blue", order=1)
    PollOption.objects.create(poll=poll, text="Green", order=2)
    return poll


class TestPollModel:
    """Tests for the Poll model."""

    def test_poll_str(self, poll):
        assert str(poll) == "What is your favorite color?"

    def test_poll_one_to_one_with_post(self, poll, post):
        assert poll.post == post
        assert post.poll == poll

    def test_poll_option_ordering(self, poll):
        options = list(poll.options.all())
        assert options[0].text == "Red"
        assert options[1].text == "Blue"
        assert options[2].text == "Green"

    def test_poll_option_str(self, poll):
        option = poll.options.first()
        assert str(option) == "Red"

    def test_poll_vote_str(self, poll, user):
        option = poll.options.first()
        vote = PollVote.objects.create(option=option, user=user)
        assert "voted for" in str(vote)


class TestPollVoteView:
    """Tests for poll voting."""

    def test_vote_on_poll(self, authenticated_client, poll):
        option = poll.options.first()
        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": option.id},
        )
        assert response.status_code == 201
        assert response.data["action"] == "added"
        assert PollVote.objects.filter(option=option).count() == 1

    def test_toggle_vote_off(self, authenticated_client, poll, user):
        option = poll.options.first()
        PollVote.objects.create(option=option, user=user)

        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": option.id},
        )
        assert response.status_code == 200
        assert response.data["action"] == "removed"
        assert PollVote.objects.filter(option=option).count() == 0

    def test_single_choice_replaces_vote(self, authenticated_client, poll, user):
        """Single-choice poll: voting for a new option removes the old vote."""
        options = list(poll.options.all())
        PollVote.objects.create(option=options[0], user=user)

        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": options[1].id},
        )
        assert response.status_code == 201
        assert PollVote.objects.filter(option__poll=poll, user=user).count() == 1
        assert PollVote.objects.filter(option=options[1], user=user).exists()

    def test_multi_choice_allows_multiple_votes(self, authenticated_client, post, user):
        """Multi-choice poll: user can vote for multiple options."""
        poll = Poll.objects.create(
            post=post,
            question="Select your favorites",
            allow_multiple_votes=True,
            created_by=user,
        )
        opt1 = PollOption.objects.create(poll=poll, text="A", order=0)
        opt2 = PollOption.objects.create(poll=poll, text="B", order=1)

        authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": opt1.id},
        )
        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": opt2.id},
        )
        assert response.status_code == 201
        assert PollVote.objects.filter(option__poll=poll, user=user).count() == 2

    def test_vote_requires_option_id(self, authenticated_client, poll):
        response = authenticated_client.post(f"/api/forum/polls/{poll.id}/vote/", {})
        assert response.status_code == 400

    def test_vote_invalid_option(self, authenticated_client, poll):
        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": 99999},
        )
        assert response.status_code == 404

    def test_vote_unauthenticated(self, api_client, poll):
        option = poll.options.first()
        response = api_client.post(
            f"/api/forum/polls/{poll.id}/vote/",
            {"option_id": option.id},
        )
        assert response.status_code == 401


class TestPollCreateViaThread:
    """Tests for creating polls via thread creation."""

    def test_create_thread_with_poll(self, authenticated_client, subgroup):
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            json.dumps(
                {
                    "title": "Poll Thread",
                    "content": "Check out this poll",
                    "poll_data": {
                        "question": "Best language?",
                        "allow_multiple_votes": False,
                        "is_anonymous": False,
                        "options": [{"text": "Python"}, {"text": "JavaScript"}],
                    },
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 201
        thread = Thread.objects.get(title="Poll Thread")
        post = thread.posts.first()
        assert hasattr(post, "poll")
        assert post.poll.question == "Best language?"
        assert post.poll.options.count() == 2

    def test_create_thread_without_poll(self, authenticated_client, subgroup):
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "No Poll Thread", "content": "Just text"},
        )
        assert response.status_code == 201
        thread = Thread.objects.get(title="No Poll Thread")
        post = thread.posts.first()
        assert not Poll.objects.filter(post=post).exists()

    def test_create_thread_poll_too_few_options(self, authenticated_client, subgroup):
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            json.dumps(
                {
                    "title": "Bad Poll",
                    "content": "Only one option",
                    "poll_data": {
                        "question": "Only one?",
                        "options": [{"text": "Only"}],
                    },
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 400


class TestPollCreateViaPost:
    """Tests for creating polls via post/reply creation."""

    def test_create_post_with_poll(self, authenticated_client, thread):
        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            json.dumps(
                {
                    "content": "Here is a poll",
                    "poll_data": {
                        "question": "Lunch plans?",
                        "allow_multiple_votes": True,
                        "is_anonymous": True,
                        "options": [{"text": "Pizza"}, {"text": "Sushi"}, {"text": "Tacos"}],
                    },
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 201
        post = Post.objects.get(content="Here is a poll")
        assert post.poll.question == "Lunch plans?"
        assert post.poll.allow_multiple_votes is True
        assert post.poll.is_anonymous is True
        assert post.poll.options.count() == 3


class TestPollDeleteView:
    """Tests for poll deletion."""

    def test_creator_can_delete_poll(self, authenticated_client, poll):
        response = authenticated_client.delete(f"/api/forum/polls/{poll.id}/")
        assert response.status_code == 204
        assert not Poll.objects.filter(id=poll.id).exists()

    def test_non_creator_cannot_delete_poll(self, api_client, second_user, poll):
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/forum/polls/{poll.id}/")
        assert response.status_code == 403

    def test_admin_can_delete_poll(self, admin_client, poll):
        response = admin_client.delete(f"/api/forum/polls/{poll.id}/")
        assert response.status_code == 204
        assert not Poll.objects.filter(id=poll.id).exists()


class TestPollInThreadDetail:
    """Tests for poll data appearing in thread detail."""

    def test_thread_detail_includes_poll(self, authenticated_client, thread, poll):
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        post_data = response.data["posts"][0]
        assert post_data["poll"] is not None
        assert post_data["poll"]["question"] == "What is your favorite color?"
        assert len(post_data["poll"]["options"]) == 3
        assert post_data["poll"]["total_votes"] == 0
        assert post_data["poll"]["is_own"] is True

    def test_thread_detail_poll_null_when_no_poll(self, authenticated_client, thread, post):
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        post_data = response.data["posts"][0]
        assert post_data["poll"] is None

    def test_anonymous_poll_hides_voters(self, authenticated_client, thread, post, user):
        """Anonymous poll should return empty voters list."""
        anon_poll = Poll.objects.create(
            post=post,
            question="Secret vote",
            is_anonymous=True,
            created_by=user,
        )
        opt = PollOption.objects.create(poll=anon_poll, text="Option A", order=0)
        PollOption.objects.create(poll=anon_poll, text="Option B", order=1)
        PollVote.objects.create(option=opt, user=user)

        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        poll_data = response.data["posts"][0]["poll"]
        assert poll_data["is_anonymous"] is True
        # Voters should be empty for anonymous polls
        for option in poll_data["options"]:
            assert option["voters"] == []
        # But vote counts should still be visible
        assert poll_data["options"][0]["vote_count"] == 1

    def test_non_anonymous_poll_shows_voters(self, authenticated_client, thread, post, user):
        """Non-anonymous poll should show voter details."""
        poll = Poll.objects.create(
            post=post,
            question="Public vote",
            is_anonymous=False,
            created_by=user,
        )
        opt = PollOption.objects.create(poll=poll, text="Option A", order=0)
        PollOption.objects.create(poll=poll, text="Option B", order=1)
        PollVote.objects.create(option=opt, user=user)

        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        poll_data = response.data["posts"][0]["poll"]
        assert len(poll_data["options"][0]["voters"]) == 1
        assert poll_data["options"][0]["voters"][0]["id"] == user.id
