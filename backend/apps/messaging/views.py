"""
Views for Messaging app.
"""

from django.db.models import Max, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Conversation, Message, MessageAttachment, MessageReadStatus
from .serializers import (
    AddParticipantsSerializer,
    ConversationDetailSerializer,
    ConversationSerializer,
    CreateConversationSerializer,
    CreateMessageSerializer,
    MessageSerializer,
)


class ConversationListCreateView(generics.ListCreateAPIView):
    """List user's conversations or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CreateConversationSerializer
        return ConversationSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        return (
            Conversation.objects.filter(participants=self.request.user)
            .prefetch_related("participants", "messages")
            .annotate(last_message_at=Max("messages__created_at"))
            .order_by("-last_message_at", "-updated_at")
        )

    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        participant_ids = serializer.validated_data["participant_ids"]
        initial_message = serializer.validated_data.get("initial_message", "")
        attachments = serializer.validated_data.get("attachments", [])

        # For 1-on-1 conversations, check if one already exists
        if len(participant_ids) == 1:
            other_user_id = participant_ids[0]
            existing = Conversation.objects.filter(participants=request.user).filter(
                participants=other_user_id
            )
            # Find conversation with exactly these 2 participants
            for conv in existing:
                if conv.participants.count() == 2:
                    return Response(
                        ConversationDetailSerializer(conv, context={"request": request}).data,
                        status=status.HTTP_200_OK,
                    )

        # Create new conversation
        conversation = Conversation.objects.create()
        conversation.participants.add(request.user, *participant_ids)

        # Create initial message if provided (with text or attachments)
        if initial_message or attachments:
            message = Message.objects.create(
                conversation=conversation,
                sender=request.user,
                content=initial_message,
            )

            # Create attachments
            for attachment_file in attachments:
                MessageAttachment.objects.create(
                    message=message,
                    file=attachment_file,
                    name=attachment_file.name,
                    uploaded_by=request.user,
                )

            # Send notifications to other participants in background
            from apps.notifications.tasks import notify_new_message_task

            for participant in conversation.participants.exclude(id=request.user.id):
                notify_new_message_task(
                    recipient_id=participant.id,
                    sender_id=request.user.id,
                    message_content=initial_message or "(Vedhæftet fil)",
                    conversation_id=conversation.id,
                )

        return Response(
            ConversationDetailSerializer(conversation, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ConversationDetailView(generics.RetrieveAPIView):
    """Get conversation details with messages."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationDetailSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        return Conversation.objects.filter(participants=self.request.user).prefetch_related(
            "participants", "messages", "messages__sender"
        )

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        instance = self.get_object()
        # Mark messages as read using bulk_create to avoid N+1 queries
        unread_messages = instance.messages.exclude(sender=request.user).exclude(
            read_statuses__user=request.user
        )
        read_statuses = [
            MessageReadStatus(message=msg, user=request.user) for msg in unread_messages
        ]
        MessageReadStatus.objects.bulk_create(read_statuses, ignore_conflicts=True)
        serializer = self.get_serializer(instance)
        return Response(serializer.data)


class MessageListCreateView(generics.ListCreateAPIView):
    """List messages in a conversation or send a new message."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CreateMessageSerializer
        return MessageSerializer

    def get_conversation(self) -> Conversation:
        return get_object_or_404(
            Conversation.objects.filter(participants=self.request.user),
            pk=self.kwargs["conversation_id"],
        )

    def get_queryset(self) -> QuerySet[Message]:
        conversation = self.get_conversation()
        return conversation.messages.select_related("sender").order_by("created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["conversation"] = self.get_conversation()
        return context

    def list(self, request: Request, *args, **kwargs) -> Response:
        # Mark messages as read when listing using bulk_create to avoid N+1 queries
        conversation = self.get_conversation()
        unread_messages = conversation.messages.exclude(sender=request.user).exclude(
            read_statuses__user=request.user
        )
        read_statuses = [
            MessageReadStatus(message=msg, user=request.user) for msg in unread_messages
        ]
        MessageReadStatus.objects.bulk_create(read_statuses, ignore_conflicts=True)
        return super().list(request, *args, **kwargs)


class MarkMessagesReadView(APIView):
    """Mark messages in a conversation as read."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, conversation_id: int) -> Response:
        conversation = get_object_or_404(
            Conversation.objects.filter(participants=request.user),
            pk=conversation_id,
        )
        # Get all unread messages from others
        unread_messages = conversation.messages.exclude(sender=request.user).exclude(
            read_statuses__user=request.user
        )

        # Create read statuses
        read_statuses = [
            MessageReadStatus(message=msg, user=request.user) for msg in unread_messages
        ]
        MessageReadStatus.objects.bulk_create(read_statuses, ignore_conflicts=True)

        return Response({"marked_read": len(read_statuses)})


class UnreadCountView(APIView):
    """Get total unread message count for current user."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        # Count all unread messages across all conversations
        unread_count = (
            Message.objects.filter(conversation__participants=request.user)
            .exclude(sender=request.user)
            .exclude(read_statuses__user=request.user)
            .count()
        )
        return Response({"unread_count": unread_count})


class AddParticipantsView(APIView):
    """Add participants to an existing conversation."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        # Get the conversation - user must be a participant
        conversation = get_object_or_404(
            Conversation.objects.filter(participants=request.user),
            pk=pk,
        )

        serializer = AddParticipantsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_ids = serializer.validated_data["user_ids"]

        # Get existing participant IDs
        existing_participant_ids = set(conversation.participants.values_list("id", flat=True))

        # Filter out users already in the conversation
        new_user_ids = [uid for uid in user_ids if uid not in existing_participant_ids]

        if not new_user_ids:
            return Response(
                {"detail": "All specified users are already participants"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the new users
        from apps.users.models import User

        new_users = User.objects.filter(id__in=new_user_ids)

        # Add new participants
        conversation.participants.add(*new_users)

        # Create system message
        new_user_names = ", ".join([u.first_name for u in new_users])
        system_message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=f"{request.user.first_name} tilføjede {new_user_names} til samtalen",
            is_system_message=True,
        )

        # Update conversation timestamp
        conversation.save()

        # Send WebSocket notification to newly added users
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        conversation_data = ConversationDetailSerializer(
            conversation, context={"request": request}
        ).data

        for user in new_users:
            async_to_sync(channel_layer.group_send)(
                f"user_{user.id}",
                {
                    "type": "new_conversation",
                    "conversation_id": conversation.id,
                    "conversation": conversation_data,
                },
            )

        # Broadcast the system message to existing participants
        message_data = {
            "id": system_message.id,
            "conversation": conversation.id,
            "sender": {
                "id": request.user.id,
                "first_name": request.user.first_name,
                "last_name": request.user.last_name,
                "profile_picture": (
                    request.user.profile_picture.url if request.user.profile_picture else None
                ),
            },
            "content": system_message.content,
            "is_own": False,
            "is_read": False,
            "is_system_message": True,
            "created_at": system_message.created_at.isoformat(),
            "attachments": [],
        }

        async_to_sync(channel_layer.group_send)(
            f"conversation_{conversation.id}",
            {
                "type": "chat_message",
                "message": message_data,
            },
        )

        return Response(
            ConversationDetailSerializer(conversation, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )


class LeaveConversationView(APIView):
    """Leave a conversation."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        # Get the conversation - user must be a participant
        conversation = get_object_or_404(
            Conversation.objects.filter(participants=request.user),
            pk=pk,
        )

        # Cannot leave a 1-on-1 conversation
        if conversation.participants.count() <= 2:
            return Response(
                {"detail": "Du kan ikke forlade en samtale med kun én anden person"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Remove user from participants
        conversation.participants.remove(request.user)

        # Create system message
        system_message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=f"{request.user.first_name} forlod samtalen",
            is_system_message=True,
        )

        # Update conversation timestamp
        conversation.save()

        # Broadcast the system message to remaining participants
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()

        message_data = {
            "id": system_message.id,
            "conversation": conversation.id,
            "sender": {
                "id": request.user.id,
                "first_name": request.user.first_name,
                "last_name": request.user.last_name,
                "profile_picture": (
                    request.user.profile_picture.url if request.user.profile_picture else None
                ),
            },
            "content": system_message.content,
            "is_own": False,
            "is_read": False,
            "is_system_message": True,
            "created_at": system_message.created_at.isoformat(),
            "attachments": [],
        }

        async_to_sync(channel_layer.group_send)(
            f"conversation_{conversation.id}",
            {
                "type": "chat_message",
                "message": message_data,
            },
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
