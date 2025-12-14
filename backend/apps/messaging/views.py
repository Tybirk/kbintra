"""
Views for Messaging app.
"""

from django.db.models import Max, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Conversation, Message, MessageReadStatus
from .serializers import (
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

        # For 1-on-1 conversations, check if one already exists
        if len(participant_ids) == 1:
            other_user_id = participant_ids[0]
            existing = Conversation.objects.filter(
                participants=request.user
            ).filter(participants=other_user_id)
            # Find conversation with exactly these 2 participants
            for conv in existing:
                if conv.participants.count() == 2:
                    return Response(
                        ConversationDetailSerializer(
                            conv, context={"request": request}
                        ).data,
                        status=status.HTTP_200_OK,
                    )

        # Create new conversation
        conversation = Conversation.objects.create()
        conversation.participants.add(request.user, *participant_ids)

        # Create initial message if provided
        if initial_message:
            from apps.notifications.services import notify_new_message

            message = Message.objects.create(
                conversation=conversation,
                sender=request.user,
                content=initial_message,
            )
            # Send notifications to other participants
            for participant in conversation.participants.exclude(id=request.user.id):
                notify_new_message(
                    recipient=participant,
                    sender=request.user,
                    message_content=initial_message,
                    conversation_id=conversation.id,
                )

        return Response(
            ConversationDetailSerializer(
                conversation, context={"request": request}
            ).data,
            status=status.HTTP_201_CREATED,
        )


class ConversationDetailView(generics.RetrieveAPIView):
    """Get conversation details with messages."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConversationDetailSerializer

    def get_queryset(self) -> QuerySet[Conversation]:
        return Conversation.objects.filter(
            participants=self.request.user
        ).prefetch_related("participants", "messages", "messages__sender")

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        instance = self.get_object()
        # Mark messages as read
        unread_messages = instance.messages.exclude(sender=request.user).exclude(
            read_statuses__user=request.user
        )
        for message in unread_messages:
            MessageReadStatus.objects.get_or_create(
                message=message, user=request.user
            )
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
        # Mark messages as read when listing
        conversation = self.get_conversation()
        unread_messages = conversation.messages.exclude(
            sender=request.user
        ).exclude(read_statuses__user=request.user)
        for message in unread_messages:
            MessageReadStatus.objects.get_or_create(
                message=message, user=request.user
            )
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
        unread_messages = conversation.messages.exclude(
            sender=request.user
        ).exclude(read_statuses__user=request.user)

        # Create read statuses
        read_statuses = [
            MessageReadStatus(message=msg, user=request.user)
            for msg in unread_messages
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
