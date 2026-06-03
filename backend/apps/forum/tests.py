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

    def test_folder_unique_constraint_prevents_duplicate(self, db, subgroup, folder):
        """Test folder name uniqueness within parent (model-level validation)."""
        # The UniqueConstraint is enforced at database level
        constraint_names = [c.name for c in Folder._meta.constraints]
        assert "unique_folder_subgroup_parent_name" in constraint_names


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

    def test_post_to_closed_thread_reopens_it(self, authenticated_client, thread):
        """Posting to a closed thread succeeds and auto-reopens the thread."""
        thread.is_closed = True
        thread.save()

        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/posts/",
            {"content": "Follow-up reply"},
        )
        assert response.status_code == 201
        thread.refresh_from_db()
        assert thread.is_closed is False

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


class TestThreadPinViews:
    """Tests for thread pin/unpin functionality."""

    def test_any_user_can_pin_thread(self, api_client, second_user, thread):
        """Test that any authenticated user can pin a thread."""
        api_client.force_authenticate(user=second_user)
        response = api_client.post(f"/api/forum/threads/{thread.id}/pin/")
        assert response.status_code == 200
        assert response.data["is_pinned"] is True
        thread.refresh_from_db()
        assert thread.is_pinned is True

    def test_toggle_unpin(self, authenticated_client, thread):
        """Test that pinning a pinned thread unpins it."""
        thread.is_pinned = True
        thread.save()

        response = authenticated_client.post(f"/api/forum/threads/{thread.id}/pin/")
        assert response.status_code == 200
        assert response.data["is_pinned"] is False
        thread.refresh_from_db()
        assert thread.is_pinned is False

    def test_explicit_pin_value(self, authenticated_client, thread):
        """Test that explicit is_pinned value can be passed."""
        response = authenticated_client.post(
            f"/api/forum/threads/{thread.id}/pin/",
            {"is_pinned": True},
        )
        assert response.status_code == 200
        assert response.data["is_pinned"] is True

    def test_unauthenticated_cannot_pin(self, api_client, thread):
        """Test that unauthenticated users cannot pin threads."""
        response = api_client.post(f"/api/forum/threads/{thread.id}/pin/")
        assert response.status_code == 401


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

    def test_list_folders(self, authenticated_client, user, subgroup, folder):
        """Test listing folders in a subgroup."""
        File.objects.create(
            subgroup=subgroup,
            folder=folder,
            uploaded_by=user,
            file=SimpleUploadedFile("public.txt", b"x"),
            name="public.txt",
        )
        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/folders/")
        assert response.status_code == 200
        assert len(get_results(response.data)) == 1

    def test_list_subfolders(self, authenticated_client, user, subgroup, folder, subfolder):
        """Test listing subfolders with parent parameter."""
        File.objects.create(
            subgroup=subgroup,
            folder=subfolder,
            uploaded_by=user,
            file=SimpleUploadedFile("public.txt", b"x"),
            name="public.txt",
        )
        response = authenticated_client.get(
            f"/api/forum/subgroups/{subgroup.slug}/folders/?parent={folder.id}"
        )
        assert response.status_code == 200
        results = get_results(response.data)
        assert len(results) == 1
        assert results[0]["name"] == "Test Subfolder"

    def test_folder_list_query_count_does_not_scale(self, authenticated_client, user, subgroup):
        """Regression: file_count/subfolder_count must not run a query per folder (N+1)."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        def make_folders(n: int, start: int) -> None:
            for i in range(start, start + n):
                f = Folder.objects.create(subgroup=subgroup, name=f"F{i}")
                File.objects.create(
                    subgroup=subgroup,
                    folder=f,
                    uploaded_by=user,
                    file=SimpleUploadedFile(f"f{i}.txt", b"x"),
                    name=f"f{i}.txt",
                )
                Folder.objects.create(subgroup=subgroup, name=f"S{i}", parent=f)

        url = f"/api/forum/subgroups/{subgroup.slug}/folders/"
        make_folders(2, 0)
        assert authenticated_client.get(url).status_code == 200  # warm up
        with CaptureQueriesContext(connection) as small:
            assert authenticated_client.get(url).status_code == 200

        make_folders(8, 2)
        with CaptureQueriesContext(connection) as big:
            assert authenticated_client.get(url).status_code == 200

        assert len(big) == len(small), (
            f"query count scaled with folder count: {len(small)} -> {len(big)}"
        )

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

    def test_non_member_cannot_create_folder_in_members_only_subgroup(
        self, second_authenticated_client, db
    ):
        """Non-members may upload files but not create folders in a private subgroup."""
        members_only = Subgroup.objects.create(
            name="Privat udvalg",
            description="x",
            slug="privat-udvalg",
            is_committee=True,
            allows_members=True,
        )
        response = second_authenticated_client.post(
            f"/api/forum/subgroups/{members_only.slug}/folders/",
            {"name": "Should Not Exist"},
        )
        assert response.status_code == 403
        assert not Folder.objects.filter(name="Should Not Exist").exists()

    def test_non_member_can_create_folder_in_open_subgroup(
        self, second_authenticated_client, subgroup
    ):
        """Open subgroups (allows_members=False) have no privacy boundary, so
        any authenticated user can create folders."""
        response = second_authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": "Open Folder"},
        )
        assert response.status_code == 201
        assert Folder.objects.filter(name="Open Folder").exists()

    def test_member_can_create_folder_in_members_only_subgroup(
        self, member_client, member_subgroup
    ):
        response = member_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/",
            {"name": "Member Folder"},
        )
        assert response.status_code == 201
        assert Folder.objects.filter(name="Member Folder").exists()

    def test_delete_folder_cascades_files_and_subfolders(
        self, authenticated_client, user, subgroup
    ):
        """Deleting a folder removes its files and all descendant subfolders."""
        parent = Folder.objects.create(subgroup=subgroup, name="Parent")
        child = Folder.objects.create(subgroup=subgroup, name="Child", parent=parent)
        f1 = File.objects.create(
            subgroup=subgroup,
            folder=parent,
            uploaded_by=user,
            file=SimpleUploadedFile("a.txt", b"a"),
            name="a.txt",
        )
        f2 = File.objects.create(
            subgroup=subgroup,
            folder=child,
            uploaded_by=user,
            file=SimpleUploadedFile("b.txt", b"b"),
            name="b.txt",
        )

        response = authenticated_client.delete(f"/api/forum/folders/{parent.id}/")
        assert response.status_code == 204
        assert not Folder.objects.filter(id=parent.id).exists()
        assert not Folder.objects.filter(id=child.id).exists()
        assert not File.objects.filter(id__in=[f1.id, f2.id]).exists()

    def test_non_member_cannot_delete_folder_in_members_only_subgroup(
        self, second_authenticated_client, user, member_subgroup
    ):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Privat mappe")
        File.objects.create(
            subgroup=member_subgroup,
            folder=folder,
            uploaded_by=user,
            file=SimpleUploadedFile("public.txt", b"x"),
            name="public.txt",
        )
        response = second_authenticated_client.delete(f"/api/forum/folders/{folder.id}/")
        assert response.status_code == 403
        assert Folder.objects.filter(id=folder.id).exists()

    def test_member_can_delete_folder_in_members_only_subgroup(
        self, member_client, member_subgroup
    ):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Mappe")
        response = member_client.delete(f"/api/forum/folders/{folder.id}/")
        assert response.status_code == 204
        assert not Folder.objects.filter(id=folder.id).exists()

    def test_delete_preview_returns_recursive_counts(self, authenticated_client, user, subgroup):
        parent = Folder.objects.create(subgroup=subgroup, name="Parent")
        child = Folder.objects.create(subgroup=subgroup, name="Child", parent=parent)
        Folder.objects.create(subgroup=subgroup, name="Grandchild", parent=child)
        File.objects.create(
            subgroup=subgroup,
            folder=parent,
            uploaded_by=user,
            file=SimpleUploadedFile("a.txt", b"a"),
            name="a.txt",
        )
        File.objects.create(
            subgroup=subgroup,
            folder=child,
            uploaded_by=user,
            file=SimpleUploadedFile("b.txt", b"b"),
            name="b.txt",
        )
        response = authenticated_client.get(f"/api/forum/folders/{parent.id}/delete-preview/")
        assert response.status_code == 200
        assert response.data == {"file_count": 2, "subfolder_count": 2}

    def test_delete_preview_forbidden_for_non_member_in_members_only_subgroup(
        self, second_authenticated_client, member_subgroup
    ):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Privat")
        response = second_authenticated_client.get(
            f"/api/forum/folders/{folder.id}/delete-preview/"
        )
        assert response.status_code == 403

    def test_cannot_create_duplicate_root_folder(self, authenticated_client, subgroup, folder):
        """Two root-level folders cannot share a name (NULL parent edge case)."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": folder.name},
        )
        assert response.status_code == 400
        assert "name" in response.data

    def test_cannot_create_duplicate_subfolder(
        self, authenticated_client, subgroup, folder, subfolder
    ):
        """Two subfolders under the same parent cannot share a name."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": subfolder.name, "parent": folder.id},
        )
        assert response.status_code == 400
        assert "name" in response.data

    def test_can_create_same_name_in_different_parents(
        self, authenticated_client, subgroup, folder
    ):
        """Same name is allowed when parents differ — uniqueness is per-parent."""
        other_parent = Folder.objects.create(subgroup=subgroup, name="Other")
        Folder.objects.create(subgroup=subgroup, name="Shared", parent=folder)
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/folders/",
            {"name": "Shared", "parent": other_parent.id},
        )
        assert response.status_code == 201


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

    def test_admin_cannot_delete_others_poll(self, admin_client, poll):
        response = admin_client.delete(f"/api/forum/polls/{poll.id}/")
        assert response.status_code == 403
        assert Poll.objects.filter(id=poll.id).exists()


class TestPollUpdateView:
    """Tests for poll update (PATCH)."""

    def test_creator_can_update_poll_settings(self, authenticated_client, poll):
        option_ids = list(poll.options.values_list("id", flat=True))
        response = authenticated_client.patch(
            f"/api/forum/polls/{poll.id}/",
            json.dumps(
                {
                    "question": "Updated question?",
                    "allow_multiple_votes": True,
                    "is_anonymous": True,
                    "options": [
                        {"id": option_ids[0], "text": "Red"},
                        {"id": option_ids[1], "text": "Blue"},
                        {"id": option_ids[2], "text": "Green"},
                    ],
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 200
        poll.refresh_from_db()
        assert poll.question == "Updated question?"
        assert poll.allow_multiple_votes is True
        assert poll.is_anonymous is True

    def test_can_reorder_options(self, authenticated_client, poll):
        option_ids = list(poll.options.values_list("id", flat=True))
        original_texts = list(poll.options.values_list("text", flat=True))
        response = authenticated_client.patch(
            f"/api/forum/polls/{poll.id}/",
            json.dumps(
                {
                    "options": [
                        {"id": option_ids[2], "text": original_texts[2]},
                        {"id": option_ids[0], "text": original_texts[0]},
                        {"id": option_ids[1], "text": original_texts[1]},
                    ]
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 200
        ordered = list(poll.options.order_by("order").values_list("id", flat=True))
        assert ordered == [option_ids[2], option_ids[0], option_ids[1]]

    def test_can_add_new_option(self, authenticated_client, poll):
        option_ids = list(poll.options.values_list("id", flat=True))
        original_texts = list(poll.options.values_list("text", flat=True))
        response = authenticated_client.patch(
            f"/api/forum/polls/{poll.id}/",
            json.dumps(
                {
                    "options": [
                        {"id": option_ids[0], "text": original_texts[0]},
                        {"id": option_ids[1], "text": original_texts[1]},
                        {"id": option_ids[2], "text": original_texts[2]},
                        {"text": "New option"},
                    ]
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 200
        assert poll.options.count() == 4

    def test_cannot_remove_option_with_votes(self, authenticated_client, poll, user):
        from apps.forum.models import PollVote

        option = poll.options.first()
        PollVote.objects.create(option=option, user=user)
        remaining_ids = list(poll.options.exclude(id=option.id).values_list("id", flat=True))
        remaining_texts = list(poll.options.exclude(id=option.id).values_list("text", flat=True))
        response = authenticated_client.patch(
            f"/api/forum/polls/{poll.id}/",
            json.dumps(
                {
                    "options": [
                        {"id": remaining_ids[0], "text": remaining_texts[0]},
                        {"id": remaining_ids[1], "text": remaining_texts[1]},
                    ]
                }
            ),
            content_type="application/json",
        )
        assert response.status_code == 400
        assert poll.options.count() == 3  # unchanged

    def test_non_creator_cannot_update_poll(self, api_client, second_user, poll):
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/forum/polls/{poll.id}/",
            json.dumps({"question": "Hacked?"}),
            content_type="application/json",
        )
        assert response.status_code == 403


class TestPollInThreadDetail:
    """Tests for poll data appearing in thread detail."""

    def test_thread_detail_includes_poll(self, authenticated_client, thread, poll):
        response = authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        post_data = response.data["posts"][0]
        assert post_data["poll"] is not None
        assert post_data["poll"]["question"] == "What is your favorite color?"
        assert len(post_data["poll"]["options"]) == 3
        assert post_data["poll"]["total_voters"] == 0
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


class TestPollAddOptionView:
    """Tests for adding options to an existing poll after creation."""

    def test_creator_can_add_option(self, authenticated_client, poll):
        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/options/",
            {"text": "Yellow"},
        )
        assert response.status_code == 200
        texts = [o["text"] for o in response.data["options"]]
        assert "Yellow" in texts
        assert texts[-1] == "Yellow"

    def test_others_blocked_when_flag_off(self, api_client, poll, second_user):
        api_client.force_authenticate(user=second_user)
        response = api_client.post(
            f"/api/forum/polls/{poll.id}/options/",
            {"text": "Purple"},
        )
        assert response.status_code == 403
        assert poll.options.filter(text="Purple").count() == 0

    def test_others_allowed_when_flag_on(self, api_client, poll, second_user):
        poll.allow_others_to_add_options = True
        poll.save(update_fields=["allow_others_to_add_options"])

        api_client.force_authenticate(user=second_user)
        response = api_client.post(
            f"/api/forum/polls/{poll.id}/options/",
            {"text": "Purple"},
        )
        assert response.status_code == 200
        assert poll.options.filter(text="Purple").exists()

    def test_admin_cannot_add_to_others_poll(self, admin_client, poll):
        response = admin_client.post(
            f"/api/forum/polls/{poll.id}/options/",
            {"text": "Pink"},
        )
        assert response.status_code == 403
        assert not poll.options.filter(text="Pink").exists()

    def test_blank_text_rejected(self, authenticated_client, poll):
        response = authenticated_client.post(
            f"/api/forum/polls/{poll.id}/options/",
            {"text": "   "},
        )
        assert response.status_code == 400


# =============================================================================
# Admin Rights Tests
# =============================================================================


class TestForumAdminRights:
    """Admin (is_staff) has no special privileges over forum content they did not author."""

    def test_admin_cannot_delete_others_thread(self, admin_client, thread):
        """Admin cannot DELETE a thread authored by another user."""
        thread_id = thread.id
        response = admin_client.delete(f"/api/forum/threads/{thread_id}/delete/")
        assert response.status_code == 403
        assert Thread.objects.filter(id=thread_id).exists()

    def test_admin_cannot_update_others_post(self, admin_client, post):
        """Admin cannot PATCH a post authored by another user (content edit)."""
        original_content = post.content
        response = admin_client.patch(
            f"/api/forum/posts/{post.id}/",
            {"content": "Admin corrected content"},
            format="json",
        )
        assert response.status_code == 403
        post.refresh_from_db()
        assert post.content == original_content

    def test_admin_cannot_update_others_thread_title(self, admin_client, thread):
        """Admin cannot PATCH another user's thread title."""
        original_title = thread.title
        response = admin_client.patch(
            f"/api/forum/threads/{thread.id}/update/",
            {"title": "Admin renamed"},
            format="json",
        )
        assert response.status_code == 403
        thread.refresh_from_db()
        assert thread.title == original_title

    def test_admin_cannot_delete_others_post(self, admin_client, post):
        """Admin cannot DELETE a post authored by another user."""
        post_id = post.id
        response = admin_client.delete(f"/api/forum/posts/{post_id}/")
        assert response.status_code == 403
        assert Post.objects.filter(id=post_id).exists()

    def test_admin_cannot_edit_others_thread(self, admin_client, thread, post):
        """can_edit is False for admin on another user's thread."""
        response = admin_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        assert response.data["is_own"] is False
        assert response.data["can_edit"] is False

    def test_admin_cannot_edit_others_post(self, admin_client, thread, post):
        """can_edit is False for admin on another user's post."""
        response = admin_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200
        post_data = next(p for p in response.data["posts"] if p["id"] == post.id)
        assert post_data["is_own"] is False
        assert post_data["can_edit"] is False


# =============================================================================
# Membership + Private Threads/Files Tests
# =============================================================================


@pytest.fixture
def member_subgroup(db):
    """A subgroup that allows members."""
    return Subgroup.objects.create(
        name="Grønt udvalg",
        description="Green committee",
        slug="gront-udvalg",
        is_committee=True,
        allows_members=True,
    )


@pytest.fixture
def third_user(db):
    return __import__("apps.users.models", fromlist=["User"]).User.objects.create_user(
        email="third@example.com",
        password="testpass123",
        first_name="Third",
        last_name="User",
    )


@pytest.fixture
def member_client(api_client, user, member_subgroup):
    """Authenticated client where user is a member of member_subgroup."""
    from apps.forum.models import SubgroupMembership

    SubgroupMembership.objects.create(user=user, subgroup=member_subgroup)
    SubgroupSubscription.objects.get_or_create(user=user, subgroup=member_subgroup)
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def second_authenticated_client(api_client, second_user):
    api_client.force_authenticate(user=second_user)
    return api_client


class TestMembershipCRUD:
    """Tests for membership add/remove/role/leave endpoints."""

    def test_member_can_add_members(self, member_client, member_subgroup, second_user):
        response = member_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/",
            {"user_ids": [second_user.id]},
            format="json",
        )
        assert response.status_code in (200, 201)
        from apps.forum.models import SubgroupMembership

        assert SubgroupMembership.objects.filter(
            user=second_user, subgroup=member_subgroup
        ).exists()

    def test_admin_can_add_members(self, admin_client, member_subgroup, second_user):
        response = admin_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/",
            {"user_ids": [second_user.id]},
            format="json",
        )
        assert response.status_code in (200, 201)

    def test_non_member_cannot_add_members(
        self, second_authenticated_client, member_subgroup, user
    ):
        response = second_authenticated_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/",
            {"user_ids": [user.id]},
            format="json",
        )
        assert response.status_code == 403

    def test_adding_members_to_non_member_group_fails(self, admin_client, subgroup, second_user):
        """Adding members to a group with allows_members=False should be rejected."""
        response = admin_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/members/",
            {"user_ids": [second_user.id]},
            format="json",
        )
        assert response.status_code == 400

    def test_add_member_auto_creates_subscription(self, admin_client, member_subgroup, second_user):
        assert not SubgroupSubscription.objects.filter(
            user=second_user, subgroup=member_subgroup
        ).exists()
        admin_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/",
            {"user_ids": [second_user.id]},
            format="json",
        )
        assert SubgroupSubscription.objects.filter(
            user=second_user, subgroup=member_subgroup
        ).exists()

    def test_remove_member_keeps_subscription(
        self, member_client, member_subgroup, second_user, admin_user
    ):
        from apps.forum.models import SubgroupMembership

        SubgroupMembership.objects.create(user=second_user, subgroup=member_subgroup)
        SubgroupSubscription.objects.get_or_create(user=second_user, subgroup=member_subgroup)
        response = member_client.delete(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/{second_user.id}/"
        )
        assert response.status_code in (200, 204)
        assert not SubgroupMembership.objects.filter(
            user=second_user, subgroup=member_subgroup
        ).exists()
        assert SubgroupSubscription.objects.filter(
            user=second_user, subgroup=member_subgroup
        ).exists()

    def test_self_leave_shortcut(self, member_client, member_subgroup, user):
        from apps.forum.models import SubgroupMembership

        response = member_client.post(f"/api/forum/subgroups/{member_subgroup.slug}/leave/")
        assert response.status_code in (200, 204)
        assert not SubgroupMembership.objects.filter(user=user, subgroup=member_subgroup).exists()

    def test_member_can_edit_role(self, member_client, member_subgroup, second_user):
        from apps.forum.models import SubgroupMembership

        SubgroupMembership.objects.create(user=second_user, subgroup=member_subgroup)
        response = member_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/{second_user.id}/",
            {"role": "Formand"},
            format="json",
        )
        assert response.status_code == 200
        m = SubgroupMembership.objects.get(user=second_user, subgroup=member_subgroup)
        assert m.role == "Formand"

    def test_non_member_cannot_edit_role(self, second_authenticated_client, member_subgroup, user):
        from apps.forum.models import SubgroupMembership

        SubgroupMembership.objects.create(user=user, subgroup=member_subgroup)
        response = second_authenticated_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/{user.id}/",
            {"role": "Formand"},
            format="json",
        )
        assert response.status_code == 403

    def test_creating_group_with_allows_members_auto_enrolls_creator(
        self, admin_client, admin_user
    ):
        from apps.forum.models import SubgroupMembership

        response = admin_client.post(
            "/api/forum/subgroups/",
            {
                "name": "Nyt udvalg",
                "description": "Test",
                "allows_members": True,
            },
            format="json",
        )
        assert response.status_code == 201
        assert SubgroupMembership.objects.filter(
            user=admin_user, subgroup__slug="nyt-udvalg"
        ).exists()

    def test_enabling_allows_members_auto_enrolls_editor(self, admin_client, admin_user, subgroup):
        from apps.forum.models import SubgroupMembership

        response = admin_client.patch(
            f"/api/forum/subgroups/{subgroup.slug}/update/",
            {"allows_members": True},
            format="json",
        )
        assert response.status_code == 200
        assert SubgroupMembership.objects.filter(user=admin_user, subgroup=subgroup).exists()

    def test_disable_allows_members_blocked_when_private_thread_exists(
        self, admin_client, member_subgroup, user
    ):
        Thread.objects.create(
            subgroup=member_subgroup,
            title="Privat",
            author=user,
            members_only=True,
        )
        response = admin_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/update/",
            {"allows_members": False},
            format="json",
        )
        assert response.status_code == 400

    def test_disable_allows_members_clears_memberships(self, admin_client, member_subgroup, user):
        from apps.forum.models import SubgroupMembership

        SubgroupMembership.objects.create(user=user, subgroup=member_subgroup)
        response = admin_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/update/",
            {"allows_members": False},
            format="json",
        )
        assert response.status_code == 200
        assert not SubgroupMembership.objects.filter(subgroup=member_subgroup).exists()


class TestLinksInfoMembers:
    """Tests for the members-only links_info_members field."""

    def test_non_member_get_hides_links_info_members(
        self, second_authenticated_client, member_subgroup
    ):
        member_subgroup.links_info_members = "<p>Hemmeligt</p>"
        member_subgroup.save()
        response = second_authenticated_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["links_info_members"] == ""

    def test_member_get_shows_links_info_members(self, member_client, member_subgroup):
        member_subgroup.links_info_members = "<p>Hemmeligt</p>"
        member_subgroup.save()
        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["links_info_members"] == "<p>Hemmeligt</p>"

    def test_admin_get_shows_links_info_members(self, admin_client, member_subgroup):
        member_subgroup.links_info_members = "<p>Hemmeligt</p>"
        member_subgroup.save()
        response = admin_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/")
        assert response.status_code == 200
        assert response.data["links_info_members"] == "<p>Hemmeligt</p>"

    def test_member_can_patch_links_info_members(self, member_client, member_subgroup):
        response = member_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/update/",
            {"links_info_members": "<p>Nyt</p>"},
            format="json",
        )
        assert response.status_code == 200
        member_subgroup.refresh_from_db()
        assert member_subgroup.links_info_members == "<p>Nyt</p>"

    def test_non_member_cannot_patch_links_info_members(
        self, second_authenticated_client, member_subgroup
    ):
        response = second_authenticated_client.patch(
            f"/api/forum/subgroups/{member_subgroup.slug}/update/",
            {"links_info_members": "<p>Nyt</p>"},
            format="json",
        )
        assert response.status_code == 403
        member_subgroup.refresh_from_db()
        assert member_subgroup.links_info_members == ""

    def test_patch_links_info_members_rejected_when_not_allows_members(
        self, admin_client, subgroup
    ):
        assert subgroup.allows_members is False
        response = admin_client.patch(
            f"/api/forum/subgroups/{subgroup.slug}/update/",
            {"links_info_members": "<p>Nyt</p>"},
            format="json",
        )
        assert response.status_code == 400
        subgroup.refresh_from_db()
        assert subgroup.links_info_members == ""


class TestPrivateThreadVisibility:
    """Tests for members-only thread visibility."""

    @pytest.fixture
    def private_thread(self, db, user, member_subgroup):
        return Thread.objects.create(
            subgroup=member_subgroup,
            title="Privat tråd",
            author=user,
            members_only=True,
        )

    def test_non_member_cannot_see_private_thread_in_list(
        self, second_authenticated_client, member_subgroup, private_thread
    ):
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/threads/"
        )
        assert response.status_code == 200
        ids = [t["id"] for t in get_results(response.data)]
        assert private_thread.id not in ids

    def test_non_member_gets_404_on_private_thread_detail(
        self, second_authenticated_client, private_thread
    ):
        response = second_authenticated_client.get(f"/api/forum/threads/{private_thread.id}/")
        assert response.status_code == 404

    def test_member_sees_private_thread_in_list(
        self, member_client, member_subgroup, private_thread
    ):
        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/threads/")
        assert response.status_code == 200
        ids = [t["id"] for t in get_results(response.data)]
        assert private_thread.id in ids

    def test_non_member_author_sees_own_private_thread(
        self, api_client, second_user, member_subgroup
    ):
        """Non-member author can still see their own private thread (key affordance)."""
        thread = Thread.objects.create(
            subgroup=member_subgroup,
            title="Ansøgning",
            author=second_user,
            members_only=True,
        )
        api_client.force_authenticate(user=second_user)
        response = api_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200

    def test_admin_non_member_gets_404(self, admin_client, private_thread):
        """is_staff does NOT grant bypass access to private threads."""
        response = admin_client.get(f"/api/forum/threads/{private_thread.id}/")
        assert response.status_code == 404

    def test_non_member_cannot_delete_private_thread(
        self, second_authenticated_client, private_thread
    ):
        response = second_authenticated_client.delete(
            f"/api/forum/threads/{private_thread.id}/delete/"
        )
        assert response.status_code == 404

    def test_public_thread_still_visible_to_everyone(self, second_authenticated_client, thread):
        response = second_authenticated_client.get(f"/api/forum/threads/{thread.id}/")
        assert response.status_code == 200


class TestPrivateFileVisibility:
    @pytest.fixture
    def private_file(self, db, user, member_subgroup):
        return File.objects.create(
            subgroup=member_subgroup,
            uploaded_by=user,
            name="hemmeligt.pdf",
            file=SimpleUploadedFile("hemmeligt.pdf", b"secret content"),
            members_only=True,
        )

    def test_non_member_does_not_see_private_file_in_list(
        self, second_authenticated_client, member_subgroup, private_file
    ):
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/files/"
        )
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert private_file.id not in ids

    def test_member_sees_private_file_in_list(self, member_client, member_subgroup, private_file):
        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/files/")
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert private_file.id in ids


class TestPrivateFolderVisibility:
    """Folders containing only private files must be hidden from non-members.

    A folder is shown to a non-member only when it (or any descendant) holds at
    least one file the user can see — otherwise the directory structure leaks
    the existence of private content.
    """

    @pytest.fixture
    def private_folder(self, db, user, member_subgroup):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Privat mappe")
        File.objects.create(
            subgroup=member_subgroup,
            folder=folder,
            uploaded_by=user,
            name="hemmeligt.pdf",
            file=SimpleUploadedFile("hemmeligt.pdf", b"secret"),
            members_only=True,
        )
        return folder

    @pytest.fixture
    def public_folder(self, db, user, member_subgroup):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Offentlig mappe")
        File.objects.create(
            subgroup=member_subgroup,
            folder=folder,
            uploaded_by=user,
            name="aaben.pdf",
            file=SimpleUploadedFile("aaben.pdf", b"public"),
            members_only=False,
        )
        return folder

    def test_non_member_does_not_see_private_folder_in_list(
        self, second_authenticated_client, member_subgroup, private_folder
    ):
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert private_folder.id not in ids

    def test_non_member_does_not_see_empty_folder_in_list(
        self, second_authenticated_client, db, member_subgroup
    ):
        empty = Folder.objects.create(subgroup=member_subgroup, name="Tom mappe")
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert empty.id not in ids

    def test_non_member_sees_folder_with_public_file(
        self, second_authenticated_client, member_subgroup, public_folder
    ):
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert public_folder.id in ids

    def test_non_member_sees_ancestor_when_descendant_has_public_file(
        self, second_authenticated_client, db, user, member_subgroup
    ):
        parent = Folder.objects.create(subgroup=member_subgroup, name="Forælder")
        child = Folder.objects.create(subgroup=member_subgroup, name="Barn", parent=parent)
        File.objects.create(
            subgroup=member_subgroup,
            folder=child,
            uploaded_by=user,
            name="aaben.pdf",
            file=SimpleUploadedFile("aaben.pdf", b"public"),
            members_only=False,
        )
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        ids = [f["id"] for f in get_results(response.data)]
        assert parent.id in ids

    def test_member_sees_private_folder_in_list(
        self, member_client, member_subgroup, private_folder
    ):
        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/folders/")
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert private_folder.id in ids

    def test_member_sees_empty_folder_in_list(self, member_client, db, member_subgroup):
        """A freshly created (empty) folder must remain visible to its members,
        otherwise the create-folder UX appears broken."""
        empty = Folder.objects.create(subgroup=member_subgroup, name="Tom mappe")
        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/folders/")
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert empty.id in ids

    def test_empty_folder_visible_in_open_subgroup(self, second_authenticated_client, db, subgroup):
        """Open subgroups (allows_members=False) have no privacy, so empty
        folders must be visible to everyone — otherwise creating a folder in
        an open subgroup leaves it invisible to its creator."""
        empty = Folder.objects.create(subgroup=subgroup, name="Tom mappe")
        response = second_authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/folders/")
        assert response.status_code == 200
        ids = [f["id"] for f in get_results(response.data)]
        assert empty.id in ids

    def test_non_member_cannot_retrieve_private_folder_by_slug(
        self, second_authenticated_client, member_subgroup, private_folder
    ):
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folder/{private_folder.slug}/"
        )
        assert response.status_code == 404

    def test_non_member_cannot_retrieve_private_folder_by_id(
        self, second_authenticated_client, member_subgroup, private_folder
    ):
        response = second_authenticated_client.get(f"/api/forum/folders/{private_folder.id}/")
        assert response.status_code == 404

    def test_file_count_excludes_private_files_for_non_member(
        self, second_authenticated_client, db, user, member_subgroup
    ):
        folder = Folder.objects.create(subgroup=member_subgroup, name="Blandet")
        File.objects.create(
            subgroup=member_subgroup,
            folder=folder,
            uploaded_by=user,
            name="aaben.pdf",
            file=SimpleUploadedFile("aaben.pdf", b"public"),
            members_only=False,
        )
        File.objects.create(
            subgroup=member_subgroup,
            folder=folder,
            uploaded_by=user,
            name="hemmeligt.pdf",
            file=SimpleUploadedFile("hemmeligt.pdf", b"secret"),
            members_only=True,
        )
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        results = get_results(response.data)
        row = next(r for r in results if r["id"] == folder.id)
        assert row["file_count"] == 1

    def test_subfolder_count_excludes_private_subfolders_for_non_member(
        self, second_authenticated_client, db, user, member_subgroup
    ):
        parent = Folder.objects.create(subgroup=member_subgroup, name="Forælder")
        public_child = Folder.objects.create(
            subgroup=member_subgroup, name="Offentlig", parent=parent
        )
        private_child = Folder.objects.create(
            subgroup=member_subgroup, name="Privat", parent=parent
        )
        File.objects.create(
            subgroup=member_subgroup,
            folder=public_child,
            uploaded_by=user,
            name="aaben.pdf",
            file=SimpleUploadedFile("aaben.pdf", b"public"),
            members_only=False,
        )
        File.objects.create(
            subgroup=member_subgroup,
            folder=private_child,
            uploaded_by=user,
            name="hemmeligt.pdf",
            file=SimpleUploadedFile("hemmeligt.pdf", b"secret"),
            members_only=True,
        )
        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/folders/"
        )
        results = get_results(response.data)
        row = next(r for r in results if r["id"] == parent.id)
        assert row["subfolder_count"] == 1


class TestMembershipNotifications:
    """Test that membership adds/removes trigger the right notifications."""

    def test_adding_user_creates_added_notification(
        self, admin_client, admin_user, member_subgroup, second_user
    ):
        from apps.notifications.models import Notification, NotificationType

        admin_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/members/",
            {"user_ids": [second_user.id]},
            format="json",
        )
        assert Notification.objects.filter(
            user=second_user,
            notification_type=NotificationType.SUBGROUP_MEMBER_ADDED,
        ).exists()

    def test_self_leave_does_not_notify(self, member_client, user, member_subgroup):
        from apps.notifications.models import Notification, NotificationType

        before = Notification.objects.filter(
            user=user,
            notification_type=NotificationType.SUBGROUP_MEMBER_REMOVED,
        ).count()
        member_client.post(f"/api/forum/subgroups/{member_subgroup.slug}/leave/")
        after = Notification.objects.filter(
            user=user,
            notification_type=NotificationType.SUBGROUP_MEMBER_REMOVED,
        ).count()
        assert after == before

    def test_self_auto_enroll_on_create_does_not_notify(self, admin_client, admin_user):
        from apps.notifications.models import Notification, NotificationType

        admin_client.post(
            "/api/forum/subgroups/",
            {"name": "Auto udvalg", "description": "x", "allows_members": True},
            format="json",
        )
        assert not Notification.objects.filter(
            user=admin_user,
            notification_type=NotificationType.SUBGROUP_MEMBER_ADDED,
        ).exists()


class TestPrivateThreadNotificationFanout:
    def test_non_member_subscriber_gets_no_notification_for_private_thread(
        self, member_client, second_user, member_subgroup
    ):
        """A subscriber who is not a member should NOT be notified about a private thread."""
        from apps.notifications.models import Notification

        # second_user is subscribed but NOT a member
        SubgroupSubscription.objects.create(user=second_user, subgroup=member_subgroup)

        response = member_client.post(
            f"/api/forum/subgroups/{member_subgroup.slug}/threads/",
            {
                "title": "Privat diskussion",
                "content": "Fortroligt",
                "members_only": True,
            },
            format="json",
        )
        assert response.status_code == 201

        # second_user should have no notifications about this thread
        assert not Notification.objects.filter(
            user=second_user, title__icontains="Privat diskussion"
        ).exists()


class TestCreatePrivateThreadValidation:
    def test_cannot_create_private_thread_in_non_member_group(self, authenticated_client, subgroup):
        """Creating members_only thread in a group without allows_members should fail."""
        response = authenticated_client.post(
            f"/api/forum/subgroups/{subgroup.slug}/threads/",
            {"title": "X", "content": "Y", "members_only": True},
            format="json",
        )
        assert response.status_code == 400


class TestSubgroupGallery:
    """Tests for the subgroup gallery endpoint."""

    def _make_attachment(self, db, user, thread, name, content=b"x"):
        from apps.forum.models import PostAttachment

        post = Post.objects.create(thread=thread, author=user, content="<p>see</p>")
        return PostAttachment.objects.create(
            post=post,
            uploaded_by=user,
            file=SimpleUploadedFile(name, content),
            name=name,
        )

    def test_lists_attachments_in_subgroup_newest_first(
        self, authenticated_client, db, user, subgroup, thread
    ):
        a1 = self._make_attachment(db, user, thread, "first.jpg")
        a2 = self._make_attachment(db, user, thread, "second.pdf")
        a3 = self._make_attachment(db, user, thread, "third.png")

        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/gallery/")
        assert response.status_code == 200
        results = get_results(response.data)
        ids = [item["id"] for item in results]
        assert ids == [a3.id, a2.id, a1.id]
        first = results[0]
        assert first["name"] == "third.png"
        assert first["thread_id"] == thread.id
        assert first["thread_slug"] == thread.slug
        assert first["thread_title"] == thread.title
        assert first["subgroup_slug"] == subgroup.slug

    def test_only_returns_attachments_for_the_requested_subgroup(
        self, authenticated_client, db, user, subgroup
    ):
        other = Subgroup.objects.create(name="Other", slug="other")
        t1 = Thread.objects.create(subgroup=subgroup, title="A", author=user)
        t2 = Thread.objects.create(subgroup=other, title="B", author=user)
        self._make_attachment(db, user, t1, "in-subgroup.png")
        self._make_attachment(db, user, t2, "in-other.png")

        response = authenticated_client.get(f"/api/forum/subgroups/{subgroup.slug}/gallery/")
        names = [item["name"] for item in get_results(response.data)]
        assert names == ["in-subgroup.png"]

    def test_hides_attachments_from_members_only_threads_for_non_members(
        self, second_authenticated_client, user, member_subgroup
    ):
        # Public thread + attachment.
        public_thread = Thread.objects.create(subgroup=member_subgroup, title="Public", author=user)
        self._make_attachment(None, user, public_thread, "public.png")

        # Members-only thread + attachment.
        private_thread = Thread.objects.create(
            subgroup=member_subgroup,
            title="Private",
            author=user,
            members_only=True,
        )
        self._make_attachment(None, user, private_thread, "private.png")

        response = second_authenticated_client.get(
            f"/api/forum/subgroups/{member_subgroup.slug}/gallery/"
        )
        names = [item["name"] for item in get_results(response.data)]
        assert names == ["public.png"]

    def test_members_see_attachments_from_members_only_threads(
        self, member_client, user, member_subgroup
    ):
        private_thread = Thread.objects.create(
            subgroup=member_subgroup,
            title="Private",
            author=user,
            members_only=True,
        )
        self._make_attachment(None, user, private_thread, "secret.png")

        response = member_client.get(f"/api/forum/subgroups/{member_subgroup.slug}/gallery/")
        names = [item["name"] for item in get_results(response.data)]
        assert names == ["secret.png"]

    def test_404_for_unknown_subgroup(self, authenticated_client):
        response = authenticated_client.get("/api/forum/subgroups/does-not-exist/gallery/")
        assert response.status_code == 404

    def test_requires_auth(self, api_client, subgroup):
        response = api_client.get(f"/api/forum/subgroups/{subgroup.slug}/gallery/")
        assert response.status_code in (401, 403)

    def test_paginates_with_page_param(self, authenticated_client, db, user, subgroup, thread):
        for i in range(5):
            self._make_attachment(db, user, thread, f"f{i}.png")

        response = authenticated_client.get(
            f"/api/forum/subgroups/{subgroup.slug}/gallery/?page_size=2"
        )
        assert response.status_code == 200
        assert "results" in response.data
        assert len(response.data["results"]) == 2
        assert response.data["count"] == 5
        assert response.data["next"] is not None


class TestPostAttachmentThumbnail:
    """Tests for the small-thumbnail variant on PostAttachment."""

    def _real_jpeg_bytes(self, width: int = 800, height: int = 600) -> bytes:
        """Return a valid JPEG of the requested size for use in upload tests."""
        from io import BytesIO

        from PIL import Image

        img = Image.new("RGB", (width, height), color=(40, 80, 120))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return buf.getvalue()

    def _real_heic_bytes(self, width: int = 800, height: int = 600) -> bytes:
        """Return a valid HEIC of the requested size for use in upload tests.

        Mirrors the format iPhones save photos in. Requires pillow_heif's
        opener+encoder registered at module import (already done in
        apps.forum.image_processing).
        """
        from io import BytesIO

        from PIL import Image

        # Ensure the HEIF opener+encoder are registered. Idempotent.
        import apps.forum.image_processing  # noqa: F401

        img = Image.new("RGB", (width, height), color=(40, 80, 120))
        buf = BytesIO()
        img.save(buf, format="HEIF", quality=80)
        return buf.getvalue()

    def test_thumbnail_generated_on_upload(self, authenticated_client, db, user, subgroup, thread):
        post = Post.objects.create(thread=thread, author=user, content="see file")
        # We bypass the API here to drive the serializer/task path directly.
        from apps.forum.serializers import _create_post_attachment

        upload = SimpleUploadedFile(
            "photo.jpg", self._real_jpeg_bytes(1600, 900), content_type="image/jpeg"
        )
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()

        from PIL import Image as PILImage

        assert att.thumbnail
        with att.thumbnail.open("rb") as fh, PILImage.open(fh) as thumb_img:
            assert max(thumb_img.size) <= 400
            assert thumb_img.format == "JPEG"

    def test_thumbnail_skipped_for_non_image(self, db, user, subgroup, thread):
        from apps.forum.serializers import _create_post_attachment

        post = Post.objects.create(thread=thread, author=user, content="see pdf")
        upload = SimpleUploadedFile("doc.pdf", b"not really a pdf", content_type="application/pdf")
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()
        assert not att.thumbnail

    def test_thumbnail_url_falls_back_to_file_url(self, db, user, thread):
        """When no thumbnail exists yet, the API returns the original file URL."""
        from apps.forum.models import PostAttachment
        from apps.forum.serializers import PostAttachmentSerializer

        post = Post.objects.create(thread=thread, author=user, content="x")
        att = PostAttachment.objects.create(
            post=post,
            uploaded_by=user,
            file=SimpleUploadedFile("nothumb.pdf", b"x"),
            name="nothumb.pdf",
        )
        data = PostAttachmentSerializer(att).data
        assert data["thumbnail_url"] == data["file_url"]

    def test_delete_removes_thumbnail_file(self, db, user, subgroup, thread):
        from apps.forum.serializers import _create_post_attachment

        post = Post.objects.create(thread=thread, author=user, content="see file")
        upload = SimpleUploadedFile("photo.jpg", self._real_jpeg_bytes(), content_type="image/jpeg")
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()
        assert att.thumbnail
        thumb_path = att.thumbnail.path

        att.delete()

        import os

        assert not os.path.exists(thumb_path)

    def test_thumbnail_is_smaller_than_original(self, db, user, subgroup, thread):
        from apps.forum.serializers import _create_post_attachment

        post = Post.objects.create(thread=thread, author=user, content="see file")
        upload = SimpleUploadedFile(
            "photo.jpg", self._real_jpeg_bytes(3000, 2000), content_type="image/jpeg"
        )
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()
        assert att.thumbnail
        assert att.thumbnail.size < att.file.size

    def test_thumbnail_is_square_even_for_wide_source(self, db, user, subgroup, thread):
        """Wide / panoramic sources are centre-cropped to a square so that
        cover-fit display doesn't have to upscale the shortest edge."""
        from PIL import Image as PILImage

        from apps.forum.serializers import _create_post_attachment

        post = Post.objects.create(thread=thread, author=user, content="see file")
        upload = SimpleUploadedFile(
            "panorama.jpg",
            self._real_jpeg_bytes(4000, 500),
            content_type="image/jpeg",
        )
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()
        assert att.thumbnail
        with att.thumbnail.open("rb") as fh, PILImage.open(fh) as thumb_img:
            # Square, clamped to shortest source edge (500) capped at 400.
            assert thumb_img.size == (400, 400)

    def test_heic_upload_generates_jpeg_thumbnail(self, db, user, subgroup, thread):
        """iPhone HEIC uploads are decoded via pillow-heif and saved as JPEG."""
        from PIL import Image as PILImage

        from apps.forum.serializers import _create_post_attachment

        post = Post.objects.create(thread=thread, author=user, content="see file")
        upload = SimpleUploadedFile(
            "iphone.heic",
            self._real_heic_bytes(2000, 1500),
            content_type="image/heic",
        )
        att = _create_post_attachment(post, user, upload)
        att.refresh_from_db()

        assert att.thumbnail
        with att.thumbnail.open("rb") as fh, PILImage.open(fh) as thumb_img:
            # Square crop, downsized to the 400px cap.
            assert thumb_img.size == (400, 400)
            # We always emit JPEG regardless of source format.
            assert thumb_img.format == "JPEG"
