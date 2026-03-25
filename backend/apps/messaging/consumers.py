"""
WebSocket consumers for real-time messaging.
"""

import contextlib
import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from .models import Conversation, Message, MessageReadStatus

logger = logging.getLogger(__name__)

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for chat functionality."""

    async def connect(self):
        """Handle WebSocket connection."""
        self.user = None
        self.conversations = []

        # Get token from query string
        query_string = self.scope.get("query_string", b"").decode()
        token = None
        for param in query_string.split("&"):
            if param.startswith("token="):
                token = param.split("=")[1]
                break

        if not token:
            await self.close(code=4001)
            return

        # Validate token and get user
        self.user = await self.get_user_from_token(token)
        if not self.user:
            await self.close(code=4001)
            return

        # Accept connection
        await self.accept()

        # Join user's personal notification channel
        self.user_group = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.user_group, self.channel_name)

        # Join all conversation groups the user is part of
        self.conversations = await self.get_user_conversations()
        for conv_id in self.conversations:
            await self.channel_layer.group_add(f"conversation_{conv_id}", self.channel_name)

    async def disconnect(self, close_code):
        """Handle WebSocket disconnection."""
        if self.user:
            # Leave user group
            await self.channel_layer.group_discard(self.user_group, self.channel_name)
            # Leave all conversation groups
            for conv_id in self.conversations:
                await self.channel_layer.group_discard(f"conversation_{conv_id}", self.channel_name)

    async def receive(self, text_data):
        """Handle incoming WebSocket messages."""
        try:
            data = json.loads(text_data)
            action = data.get("action")

            if action == "ping":
                await self.send(json.dumps({"type": "pong"}))
            elif action == "send_message":
                await self.handle_send_message(data)
            elif action == "mark_read":
                await self.handle_mark_read(data)
            elif action == "join_conversation":
                await self.handle_join_conversation(data)
            elif action == "typing":
                await self.handle_typing(data)

        except json.JSONDecodeError:
            await self.send(json.dumps({"error": "Invalid JSON"}))
        except Exception:
            logger.exception("Unexpected error in WebSocket receive")
            with contextlib.suppress(Exception):
                await self.send(json.dumps({"error": "Internal server error"}))

    async def handle_send_message(self, data: dict):
        """Handle sending a new message."""
        conversation_id = data.get("conversation_id")
        content = data.get("content", "").strip()

        if not conversation_id or not content:
            await self.send(json.dumps({"error": "Missing conversation_id or content"}))
            return

        # Create message in database
        message = await self.create_message(conversation_id, content)
        if not message:
            await self.send(json.dumps({"error": "Failed to send message"}))
            return

        # Broadcast message to conversation group
        try:
            await self.channel_layer.group_send(
                f"conversation_{conversation_id}",
                {
                    "type": "chat_message",
                    "message": message,
                },
            )
        except Exception:
            logger.exception("Failed to broadcast message to conversation %s", conversation_id)
            await self.send(json.dumps({"error": "Message saved but failed to broadcast"}))

    async def handle_mark_read(self, data: dict):
        """Handle marking messages as read."""
        conversation_id = data.get("conversation_id")
        if not conversation_id:
            return

        success = await self.mark_messages_read(conversation_id)
        if not success:
            return

        # Notify sender that messages were read
        try:
            await self.channel_layer.group_send(
                f"conversation_{conversation_id}",
                {
                    "type": "messages_read",
                    "conversation_id": conversation_id,
                    "reader_id": self.user.id,
                },
            )
        except Exception:
            logger.exception("Failed to broadcast read status for conversation %s", conversation_id)

    async def handle_join_conversation(self, data: dict):
        """Handle joining a new conversation (after it's created via REST API)."""
        conversation_id = data.get("conversation_id")
        if not conversation_id:
            return

        # Verify user is participant
        is_participant = await self.is_conversation_participant(conversation_id)
        if is_participant and conversation_id not in self.conversations:
            self.conversations.append(conversation_id)
            await self.channel_layer.group_add(f"conversation_{conversation_id}", self.channel_name)

    async def handle_typing(self, data: dict):
        """Handle typing indicator."""
        conversation_id = data.get("conversation_id")
        if not conversation_id:
            return

        try:
            await self.channel_layer.group_send(
                f"conversation_{conversation_id}",
                {
                    "type": "user_typing",
                    "conversation_id": conversation_id,
                    "user_id": self.user.id,
                    "user_name": f"{self.user.first_name}",
                },
            )
        except Exception:
            logger.exception("Failed to broadcast typing indicator")

    async def chat_message(self, event):
        """Send message to WebSocket."""
        # Compute is_own dynamically based on who is receiving the message
        message = {**event["message"], "is_own": event["message"]["sender"]["id"] == self.user.id}
        await self.send(
            json.dumps(
                {
                    "type": "new_message",
                    "message": message,
                }
            )
        )

    async def messages_read(self, event):
        """Notify that messages were read."""
        # Don't send to the reader themselves
        if event["reader_id"] != self.user.id:
            await self.send(
                json.dumps(
                    {
                        "type": "messages_read",
                        "conversation_id": event["conversation_id"],
                        "reader_id": event["reader_id"],
                    }
                )
            )

    async def user_typing(self, event):
        """Send typing indicator."""
        # Don't send to the typer themselves
        if event["user_id"] != self.user.id:
            await self.send(
                json.dumps(
                    {
                        "type": "typing",
                        "conversation_id": event["conversation_id"],
                        "user_id": event["user_id"],
                        "user_name": event["user_name"],
                    }
                )
            )

    async def new_conversation(self, event):
        """Notify user of a new conversation they were added to."""
        conversation_id = event["conversation_id"]
        if conversation_id not in self.conversations:
            self.conversations.append(conversation_id)
            await self.channel_layer.group_add(f"conversation_{conversation_id}", self.channel_name)
        await self.send(
            json.dumps(
                {
                    "type": "new_conversation",
                    "conversation": event["conversation"],
                }
            )
        )

    async def message_edited(self, event):
        """Broadcast message edit to all clients in conversation."""
        await self.send(
            json.dumps(
                {
                    "type": "message_edited",
                    "message_id": event["message_id"],
                    "conversation_id": event["conversation_id"],
                    "content": event["content"],
                    "edited_at": event["edited_at"],
                }
            )
        )

    async def message_deleted(self, event):
        """Broadcast message deletion to all clients in conversation."""
        await self.send(
            json.dumps(
                {
                    "type": "message_deleted",
                    "message_id": event["message_id"],
                    "conversation_id": event["conversation_id"],
                }
            )
        )

    async def conversation_renamed(self, event):
        """Broadcast conversation rename to all clients in conversation."""
        await self.send(
            json.dumps(
                {
                    "type": "conversation_renamed",
                    "conversation_id": event["conversation_id"],
                    "name": event["name"],
                }
            )
        )

    async def message_reacted(self, event):
        """Broadcast reaction update to all clients in conversation."""
        await self.send(
            json.dumps(
                {
                    "type": "message_reacted",
                    "message_id": event["message_id"],
                    "conversation_id": event["conversation_id"],
                    "reactions": event["reactions"],
                }
            )
        )

    async def new_notification(self, event):
        """Send notification to user via WebSocket."""
        await self.send(
            json.dumps(
                {
                    "type": "new_notification",
                    "notification": event["notification"],
                }
            )
        )

    @database_sync_to_async
    def get_user_from_token(self, token: str) -> User | None:
        """Validate JWT token and return user."""
        try:
            access_token = AccessToken(token)
            user_id = access_token["user_id"]
            return User.objects.get(id=user_id)
        except Exception as e:
            logger.warning("WebSocket JWT validation failed: %s", e)
            return None

    @database_sync_to_async
    def get_user_conversations(self) -> list[int]:
        """Get list of conversation IDs the user is part of."""
        return list(
            Conversation.objects.filter(participants=self.user).values_list("id", flat=True)
        )

    @database_sync_to_async
    def is_conversation_participant(self, conversation_id: int) -> bool:
        """Check if user is a participant in the conversation."""
        return Conversation.objects.filter(id=conversation_id, participants=self.user).exists()

    @database_sync_to_async
    def create_message(self, conversation_id: int, content: str) -> dict | None:
        """Create a new message in the database."""
        try:
            from django.db import transaction

            with transaction.atomic():
                conversation = Conversation.objects.get(id=conversation_id, participants=self.user)
                message = Message.objects.create(
                    conversation=conversation,
                    sender=self.user,
                    content=content,
                )
                # Update conversation timestamp
                conversation.save()

            # Send notifications to other participants in background (outside transaction)
            from apps.notifications.tasks import notify_new_message_task

            for participant in conversation.participants.exclude(id=self.user.id):
                notify_new_message_task(
                    recipient_id=participant.id,
                    sender_id=self.user.id,
                    message_content=content,
                    conversation_id=conversation_id,
                    message_id=message.id,
                )

            # Return serialized message
            return {
                "id": message.id,
                "conversation": conversation_id,
                "sender": {
                    "id": self.user.id,
                    "first_name": self.user.first_name,
                    "last_name": self.user.last_name,
                    "profile_picture": (
                        self.user.profile_picture.url if self.user.profile_picture else None
                    ),
                },
                "content": message.content,
                "is_own": True,
                "is_read": False,
                "is_system_message": message.is_system_message,
                "created_at": message.created_at.isoformat(),
                "attachments": [],  # WebSocket messages are text-only
            }
        except Exception:
            logger.exception("Failed to create message in conversation")
            return None

    @database_sync_to_async
    def mark_messages_read(self, conversation_id: int) -> bool:
        """Mark all messages in conversation as read by current user."""
        try:
            conversation = Conversation.objects.get(id=conversation_id, participants=self.user)
            unread_messages = conversation.messages.exclude(sender=self.user).exclude(
                read_statuses__user=self.user
            )
            # Use bulk_create to avoid N+1 queries
            read_statuses = [
                MessageReadStatus(message=msg, user=self.user) for msg in unread_messages
            ]
            MessageReadStatus.objects.bulk_create(read_statuses, ignore_conflicts=True)
            return True
        except Exception:
            logger.exception("Failed to mark messages as read for conversation %s", conversation_id)
            return False
