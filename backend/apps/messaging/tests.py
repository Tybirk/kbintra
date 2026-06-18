"""
Tests for the Messaging app.
"""

import pytest

from apps.messaging.models import Conversation, Message, MessageReadStatus


@pytest.fixture
def conversation(db, user, second_user):
    """Create a test conversation."""
    conv = Conversation.objects.create()
    conv.participants.add(user, second_user)
    return conv


@pytest.fixture
def message(db, user, conversation):
    """Create a test message."""
    return Message.objects.create(
        conversation=conversation,
        sender=user,
        content="Hello, this is a test message!",
    )


# =============================================================================
# Model Tests
# =============================================================================


class TestConversationModel:
    """Tests for the Conversation model."""

    def test_conversation_str(self, conversation):
        """Test string representation of conversation."""
        assert "Conversation" in str(conversation)


class TestMessageModel:
    """Tests for the Message model."""

    def test_message_str(self, message):
        """Test string representation of message."""
        assert "Hello" in str(message) or "Test User" in str(message)


# =============================================================================
# API Tests
# =============================================================================


class TestConversationAPI:
    """Tests for the Conversation API endpoints."""

    def test_list_conversations_unauthenticated(self, api_client):
        """Test that unauthenticated users cannot list conversations."""
        response = api_client.get("/api/messages/conversations/")
        assert response.status_code == 401

    def test_list_conversations(self, authenticated_client, conversation):
        """Test listing conversations."""
        response = authenticated_client.get("/api/messages/conversations/")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1

    def test_create_conversation(self, authenticated_client, second_user):
        """Test creating a conversation."""
        response = authenticated_client.post(
            "/api/messages/conversations/",
            {
                "participant_ids": [second_user.id],
                "initial_message": "Hi there!",
            },
            format="json",
        )
        assert response.status_code == 201
        assert Conversation.objects.count() == 1
        assert Message.objects.filter(content="Hi there!").exists()

    def test_create_conversation_returns_existing(
        self, authenticated_client, second_user, conversation
    ):
        """Test that creating a conversation with existing user returns existing conversation."""
        response = authenticated_client.post(
            "/api/messages/conversations/",
            {"participant_ids": [second_user.id]},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["id"] == conversation.id

    def test_create_conversation_existing_sends_initial_message(
        self, authenticated_client, second_user, conversation
    ):
        """When sending to an existing 1-on-1 conversation, the initial_message must be delivered."""
        response = authenticated_client.post(
            "/api/messages/conversations/",
            {
                "participant_ids": [second_user.id],
                "initial_message": "Hej igen!",
            },
            format="json",
        )
        # Should return the existing conversation, not create a new one
        assert response.status_code == 200
        assert response.json()["id"] == conversation.id
        assert Conversation.objects.count() == 1
        # The initial message must have been created in the existing conversation
        assert Message.objects.filter(content="Hej igen!", conversation=conversation).exists()

    def test_get_conversation_detail(self, authenticated_client, conversation):
        """Test getting conversation details."""
        response = authenticated_client.get(f"/api/messages/conversations/{conversation.id}/")
        assert response.status_code == 200

    def test_cannot_access_others_conversation(self, api_client, admin_user, conversation):
        """Test that users cannot access conversations they're not part of."""
        api_client.force_authenticate(user=admin_user)
        response = api_client.get(f"/api/messages/conversations/{conversation.id}/")
        assert response.status_code == 404


class TestGroupConversationAPI:
    """Tests for group conversations."""

    def test_create_group_conversation(self, authenticated_client, second_user, admin_user):
        """Test creating a group conversation with multiple participants."""
        response = authenticated_client.post(
            "/api/messages/conversations/",
            {
                "participant_ids": [second_user.id, admin_user.id],
                "initial_message": "Hello group!",
            },
            format="json",
        )
        assert response.status_code == 201
        conv = Conversation.objects.get(id=response.json()["id"])
        assert conv.participants.count() == 3  # User + second_user + admin_user
        assert Message.objects.filter(content="Hello group!").exists()

    def test_group_conversation_shows_all_participants(
        self, authenticated_client, user, second_user, admin_user
    ):
        """Test that group conversation shows all participants."""
        # Create group conversation
        conv = Conversation.objects.create()
        conv.participants.add(user, second_user, admin_user)

        response = authenticated_client.get(f"/api/messages/conversations/{conv.id}/")
        assert response.status_code == 200

        data = response.json()
        # other_participants should not include the requesting user
        assert len(data["other_participants"]) == 2

    def test_group_conversation_listed_in_conversations(
        self, authenticated_client, user, second_user, admin_user
    ):
        """Test that group conversations appear in conversation list."""
        conv = Conversation.objects.create()
        conv.participants.add(user, second_user, admin_user)

        response = authenticated_client.get("/api/messages/conversations/")
        assert response.status_code == 200

        data = response.json()
        results = data if isinstance(data, list) else data.get("results", data)
        assert len(results) == 1
        assert len(results[0]["other_participants"]) == 2


class TestMessageAPI:
    """Tests for the Message API endpoints."""

    def test_list_messages(self, authenticated_client, conversation, message):
        """Test listing messages in a conversation."""
        response = authenticated_client.get(
            f"/api/messages/conversations/{conversation.id}/messages/"
        )
        assert response.status_code == 200

        data = response.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        assert len(results) == 1

    def test_send_message(self, authenticated_client, conversation):
        """Test sending a message."""
        response = authenticated_client.post(
            f"/api/messages/conversations/{conversation.id}/messages/",
            {"content": "New message!"},
            format="json",
        )
        assert response.status_code == 201
        assert Message.objects.filter(content="New message!").exists()


class TestMarkMessagesReadAPI:
    """Tests for the Mark Messages Read API endpoint."""

    def test_mark_messages_read(self, api_client, second_user, conversation, message):
        """Test marking messages as read."""
        api_client.force_authenticate(user=second_user)
        response = api_client.post(f"/api/messages/conversations/{conversation.id}/read/")
        assert response.status_code == 200

        # Check that message is now read
        assert MessageReadStatus.objects.filter(message=message, user=second_user).exists()


class TestMarkMessagesUnreadAPI:
    """Tests for the Mark Messages Unread API endpoint."""

    def test_mark_messages_unread(self, api_client, second_user, conversation, message):
        """Reading then marking unread makes the conversation unread again."""
        api_client.force_authenticate(user=second_user)

        # Read the conversation first (creates a read status for second_user).
        api_client.post(f"/api/messages/conversations/{conversation.id}/read/")
        assert MessageReadStatus.objects.filter(message=message, user=second_user).exists()
        assert api_client.get("/api/messages/unread-count/").json()["unread_count"] == 0

        # Now mark it as unread.
        response = api_client.post(f"/api/messages/conversations/{conversation.id}/unread/")
        assert response.status_code == 200
        assert response.json()["marked_unread"] == 1

        # The read status is gone and the conversation is unread again.
        assert not MessageReadStatus.objects.filter(message=message, user=second_user).exists()
        assert api_client.get("/api/messages/unread-count/").json()["unread_count"] == 1

    def test_mark_unread_only_affects_latest_message(
        self, api_client, user, second_user, conversation, message
    ):
        """Marking a conversation unread clears only the latest message, not all."""
        # A second, later message from the other participant.
        latest = Message.objects.create(
            conversation=conversation,
            sender=user,
            content="A later message",
        )

        api_client.force_authenticate(user=second_user)
        api_client.post(f"/api/messages/conversations/{conversation.id}/read/")

        response = api_client.post(f"/api/messages/conversations/{conversation.id}/unread/")
        assert response.status_code == 200
        assert response.json()["marked_unread"] == 1

        # Only the latest message is unread; the earlier one stays read.
        assert not MessageReadStatus.objects.filter(message=latest, user=second_user).exists()
        assert MessageReadStatus.objects.filter(message=message, user=second_user).exists()
        assert api_client.get("/api/messages/unread-count/").json()["unread_count"] == 1

    def test_mark_unread_leaves_own_messages_untouched(
        self, api_client, second_user, conversation, message
    ):
        """Marking unread must not delete read statuses for the user's own messages."""
        # second_user sends their own message and reads the whole conversation.
        own_message = Message.objects.create(
            conversation=conversation,
            sender=second_user,
            content="My own reply",
        )
        own_read = MessageReadStatus.objects.create(message=own_message, user=second_user)

        api_client.force_authenticate(user=second_user)
        api_client.post(f"/api/messages/conversations/{conversation.id}/read/")

        response = api_client.post(f"/api/messages/conversations/{conversation.id}/unread/")
        assert response.status_code == 200

        # The other user's message read status is deleted...
        assert not MessageReadStatus.objects.filter(message=message, user=second_user).exists()
        # ...but the read status for second_user's own message is preserved.
        assert MessageReadStatus.objects.filter(pk=own_read.pk).exists()

    def test_mark_unread_unauthenticated(self, api_client, conversation):
        """Unauthenticated users cannot mark a conversation unread."""
        response = api_client.post(f"/api/messages/conversations/{conversation.id}/unread/")
        assert response.status_code == 401

    def test_cannot_mark_unread_others_conversation(self, api_client, admin_user, conversation):
        """Users cannot mark a conversation they're not part of as unread."""
        api_client.force_authenticate(user=admin_user)
        response = api_client.post(f"/api/messages/conversations/{conversation.id}/unread/")
        assert response.status_code == 404


class TestMarkMessageUnreadAPI:
    """Tests for the per-message Mark Unread API endpoint."""

    def test_mark_message_unread(self, api_client, second_user, conversation, message):
        """Reading then marking a single message unread makes it unread again."""
        api_client.force_authenticate(user=second_user)

        api_client.post(f"/api/messages/conversations/{conversation.id}/read/")
        assert MessageReadStatus.objects.filter(message=message, user=second_user).exists()

        response = api_client.post(f"/api/messages/messages/{message.id}/unread/")
        assert response.status_code == 200
        assert response.json()["marked_unread"] == 1

        assert not MessageReadStatus.objects.filter(message=message, user=second_user).exists()
        assert api_client.get("/api/messages/unread-count/").json()["unread_count"] == 1

    def test_mark_own_message_unread_is_noop(self, api_client, second_user, conversation):
        """Marking one's own message unread is a no-op (own messages aren't tracked)."""
        own_message = Message.objects.create(
            conversation=conversation,
            sender=second_user,
            content="My own message",
        )
        api_client.force_authenticate(user=second_user)

        response = api_client.post(f"/api/messages/messages/{own_message.id}/unread/")
        assert response.status_code == 200
        assert response.json()["marked_unread"] == 0

    def test_mark_message_unread_unauthenticated(self, api_client, message):
        """Unauthenticated users cannot mark a message unread."""
        response = api_client.post(f"/api/messages/messages/{message.id}/unread/")
        assert response.status_code == 401

    def test_cannot_mark_message_in_others_conversation(self, api_client, admin_user, message):
        """Users cannot mark a message in a conversation they're not part of."""
        api_client.force_authenticate(user=admin_user)
        response = api_client.post(f"/api/messages/messages/{message.id}/unread/")
        assert response.status_code == 404


class TestUnreadCountAPI:
    """Tests for the Unread Count API endpoint."""

    def test_unread_count(self, api_client, second_user, conversation, message):
        """Test getting unread message count."""
        api_client.force_authenticate(user=second_user)
        response = api_client.get("/api/messages/unread-count/")
        assert response.status_code == 200
        assert response.json()["unread_count"] == 1

    def test_unread_count_after_read(self, api_client, second_user, conversation, message):
        """Test unread count after marking as read."""
        api_client.force_authenticate(user=second_user)

        # Mark as read
        api_client.post(f"/api/messages/conversations/{conversation.id}/read/")

        # Check count
        response = api_client.get("/api/messages/unread-count/")
        assert response.status_code == 200
        assert response.json()["unread_count"] == 0


class TestMessageEditAPI:
    """Tests for the message edit endpoint (PATCH /api/messages/messages/<id>/edit/)."""

    def test_sender_can_edit_own_message(self, authenticated_client, message):
        """Sender can edit their own message; content and edited_at are updated."""
        response = authenticated_client.patch(
            f"/api/messages/messages/{message.id}/edit/",
            {"content": "Edited content"},
            format="json",
        )
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "Edited content"
        assert data["edited_at"] is not None
        message.refresh_from_db()
        assert message.content == "Edited content"
        assert message.edited_at is not None

    def test_non_sender_cannot_edit_message(self, api_client, second_user, message):
        """Non-sender gets 404 (message filtered by sender in lookup)."""
        api_client.force_authenticate(user=second_user)
        response = api_client.patch(
            f"/api/messages/messages/{message.id}/edit/",
            {"content": "Should not work"},
            format="json",
        )
        assert response.status_code == 404

    def test_edit_system_message_rejected(self, authenticated_client, conversation, user):
        """System messages cannot be edited."""
        from apps.messaging.models import Message

        system_msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            content="System notification",
            is_system_message=True,
        )
        response = authenticated_client.patch(
            f"/api/messages/messages/{system_msg.id}/edit/",
            {"content": "New content"},
            format="json",
        )
        assert response.status_code == 400

    def test_edit_deleted_message_rejected(self, authenticated_client, conversation, user):
        """Already-deleted messages cannot be edited."""
        from apps.messaging.models import Message

        deleted_msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            content="",
            is_deleted=True,
        )
        response = authenticated_client.patch(
            f"/api/messages/messages/{deleted_msg.id}/edit/",
            {"content": "New content"},
            format="json",
        )
        assert response.status_code == 400

    def test_edit_with_empty_content_rejected(self, authenticated_client, message):
        """Empty content string is rejected."""
        response = authenticated_client.patch(
            f"/api/messages/messages/{message.id}/edit/",
            {"content": "   "},
            format="json",
        )
        assert response.status_code == 400

    def test_unauthenticated_edit_rejected(self, api_client, message):
        """Unauthenticated request is rejected."""
        response = api_client.patch(
            f"/api/messages/messages/{message.id}/edit/",
            {"content": "New content"},
            format="json",
        )
        assert response.status_code == 401


class TestMessageUnsendAPI:
    """Tests for the message unsend endpoint (DELETE /api/messages/messages/<id>/unsend/)."""

    def test_sender_can_unsend_own_message(self, authenticated_client, message):
        """Sender can unsend their own message; message is soft-deleted."""
        response = authenticated_client.delete(f"/api/messages/messages/{message.id}/unsend/")
        assert response.status_code == 204
        message.refresh_from_db()
        assert message.is_deleted is True
        assert message.content == ""

    def test_non_sender_cannot_unsend_message(self, api_client, second_user, message):
        """Non-sender gets 404 (message filtered by sender in lookup)."""
        api_client.force_authenticate(user=second_user)
        response = api_client.delete(f"/api/messages/messages/{message.id}/unsend/")
        assert response.status_code == 404
        message.refresh_from_db()
        assert message.is_deleted is False

    def test_unsend_system_message_rejected(self, authenticated_client, conversation, user):
        """System messages cannot be unsent."""
        from apps.messaging.models import Message

        system_msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            content="System notification",
            is_system_message=True,
        )
        response = authenticated_client.delete(f"/api/messages/messages/{system_msg.id}/unsend/")
        assert response.status_code == 400
        system_msg.refresh_from_db()
        assert system_msg.is_deleted is False

    def test_unauthenticated_unsend_rejected(self, api_client, message):
        """Unauthenticated request is rejected."""
        response = api_client.delete(f"/api/messages/messages/{message.id}/unsend/")
        assert response.status_code == 401


class TestConversationDetailQueryCount:
    """Regression: serializing a conversation's messages must not run queries that
    scale with the number of messages (read-status / attachments were N+1)."""

    def _seed(self, conversation, sender, count, start=0):
        from apps.messaging.models import Message

        for i in range(start, start + count):
            Message.objects.create(conversation=conversation, sender=sender, content=f"msg {i}")

    def test_detail_query_count_does_not_scale_with_messages(
        self, authenticated_client, conversation, second_user
    ):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        url = f"/api/messages/conversations/{conversation.id}/"

        # A few messages from the other participant.
        self._seed(conversation, second_user, 3)
        # Warm up (first request marks messages read / primes any one-off queries).
        assert authenticated_client.get(url).status_code == 200
        with CaptureQueriesContext(connection) as small:
            assert authenticated_client.get(url).status_code == 200

        # Many more messages — query count must stay the same (no N+1).
        self._seed(conversation, second_user, 20, start=3)
        assert authenticated_client.get(url).status_code == 200
        with CaptureQueriesContext(connection) as big:
            assert authenticated_client.get(url).status_code == 200

        assert len(big) == len(small), (
            f"query count scaled with message count: {len(small)} -> {len(big)}"
        )
