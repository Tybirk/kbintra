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
        results = data.get("results", data)
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

    def test_get_conversation_detail(self, authenticated_client, conversation):
        """Test getting conversation details."""
        response = authenticated_client.get(f"/api/messages/conversations/{conversation.id}/")
        assert response.status_code == 200

    def test_cannot_access_others_conversation(self, api_client, admin_user, conversation):
        """Test that users cannot access conversations they're not part of."""
        api_client.force_authenticate(user=admin_user)
        response = api_client.get(f"/api/messages/conversations/{conversation.id}/")
        assert response.status_code == 404


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
        assert MessageReadStatus.objects.filter(
            message=message, user=second_user
        ).exists()


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
