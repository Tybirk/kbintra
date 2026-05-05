"""
Views for Messaging app.
"""

from django.db.models import Count, Max, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Conversation, Message, MessageAttachment, MessageReaction, MessageReadStatus
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
            .prefetch_related("participants")
            .annotate(last_message_at=Max("messages__created_at"))
            .order_by("-last_message_at", "-updated_at")
        )

    def list(self, request: Request, *args, **kwargs) -> Response:
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        instances = list(page) if page is not None else list(queryset)

        conv_ids = [c.id for c in instances]
        if conv_ids:
            # Batch last messages: 2 queries instead of N
            last_msg_id_qs = (
                Message.objects.filter(conversation_id__in=conv_ids)
                .values("conversation_id")
                .annotate(last_id=Max("id"))
                .values_list("last_id", flat=True)
            )
            last_msgs = {
                m.conversation_id: m for m in Message.objects.filter(id__in=last_msg_id_qs)
            }
            # Batch unread counts: 1 query instead of N
            unread_counts = dict(
                Message.objects.filter(conversation_id__in=conv_ids)
                .exclude(sender=request.user)
                .exclude(read_statuses__user=request.user)
                .values("conversation_id")
                .annotate(cnt=Count("id", distinct=True))
                .values_list("conversation_id", "cnt")
            )
        else:
            last_msgs = {}
            unread_counts = {}

        context = self.get_serializer_context()
        context["last_messages"] = last_msgs
        context["unread_counts"] = {cid: unread_counts.get(cid, 0) for cid in conv_ids}

        serializer = ConversationSerializer(instances, many=True, context=context)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

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
                    # Send the initial message into the existing conversation if provided
                    if initial_message or attachments:
                        message = Message.objects.create(
                            conversation=conv,
                            sender=request.user,
                            content=initial_message,
                        )
                        attachment_objects = []
                        for attachment_file in attachments:
                            att = MessageAttachment.objects.create(
                                message=message,
                                file=attachment_file,
                                name=attachment_file.name,
                                uploaded_by=request.user,
                            )
                            attachment_objects.append(att)

                        # Broadcast message via WebSocket so all clients update instantly
                        from asgiref.sync import async_to_sync
                        from channels.layers import get_channel_layer

                        channel_layer = get_channel_layer()
                        user = request.user
                        message_data = {
                            "id": message.id,
                            "conversation": conv.id,
                            "sender": {
                                "id": user.id,
                                "first_name": user.first_name,
                                "last_name": user.last_name,
                                "profile_picture": (
                                    user.profile_picture.url if user.profile_picture else None
                                ),
                            },
                            "content": message.content,
                            "is_own": False,  # set per-client by the consumer
                            "is_read": False,
                            "is_system_message": False,
                            "created_at": message.created_at.isoformat(),
                            "attachments": [
                                {
                                    "id": att.id,
                                    "name": att.name,
                                    "file_url": att.file.url if att.file else "",
                                }
                                for att in attachment_objects
                            ],
                        }
                        async_to_sync(channel_layer.group_send)(
                            f"conversation_{conv.id}",
                            {"type": "chat_message", "message": message_data},
                        )

                        from apps.notifications.tasks import notify_new_message_task

                        for participant in conv.participants.exclude(id=request.user.id):
                            notify_new_message_task(
                                recipient_id=participant.id,
                                sender_id=request.user.id,
                                message_content=initial_message or "(Vedhæftet fil)",
                                conversation_id=conv.id,
                                message_id=message.id,
                            )
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
                    message_id=message.id,
                )

        # Notify other participants over WebSocket so their conversation list
        # refreshes immediately and their socket joins the conversation group.
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        conversation_data = ConversationDetailSerializer(
            conversation, context={"request": request}
        ).data
        for participant in conversation.participants.exclude(id=request.user.id):
            async_to_sync(channel_layer.group_send)(
                f"user_{participant.id}",
                {
                    "type": "new_conversation",
                    "conversation_id": conversation.id,
                    "conversation": conversation_data,
                },
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
            "participants", "messages", "messages__sender", "messages__reactions__user"
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
        return (
            conversation.messages.select_related("sender")
            .prefetch_related("reactions__user")
            .order_by("created_at")
        )

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


class RenameConversationView(APIView):
    """Rename a conversation. Any participant can rename."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        conversation = get_object_or_404(
            Conversation.objects.filter(participants=request.user),
            pk=pk,
        )

        name = request.data.get("name", "").strip()
        if len(name) > 100:
            return Response(
                {"detail": "Navnet må højst være 100 tegn"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_name = conversation.name
        conversation.name = name
        conversation.save()

        # Create system message about the rename
        if name:
            if old_name:
                system_content = f'{request.user.first_name} ændrede samtalens navn fra "{old_name}" til "{name}"'
            else:
                system_content = f'{request.user.first_name} navngav samtalen "{name}"'
        else:
            system_content = f"{request.user.first_name} fjernede samtalens navn"

        system_message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=system_content,
            is_system_message=True,
        )

        # Broadcast via WebSocket
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()

        # Broadcast the system message
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
            {"type": "chat_message", "message": message_data},
        )

        # Broadcast conversation rename event
        async_to_sync(channel_layer.group_send)(
            f"conversation_{conversation.id}",
            {
                "type": "conversation_renamed",
                "conversation_id": conversation.id,
                "name": name,
            },
        )

        return Response(ConversationSerializer(conversation, context={"request": request}).data)


class MessageEditView(APIView):
    """Edit a message. Only the sender can edit their own non-system messages."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, message_id: int) -> Response:
        message = get_object_or_404(Message, pk=message_id, sender=request.user)

        if message.is_system_message or message.is_deleted:
            return Response(
                {"detail": "Kan ikke redigere denne besked"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        content = request.data.get("content", "").strip()
        if not content:
            return Response(
                {"detail": "Besked kan ikke være tom"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message.content = content
        message.edited_at = timezone.now()
        message.save()

        # Broadcast edit via WebSocket
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"conversation_{message.conversation_id}",
            {
                "type": "message_edited",
                "message_id": message.id,
                "conversation_id": message.conversation_id,
                "content": message.content,
                "edited_at": message.edited_at.isoformat(),
            },
        )

        return Response(MessageSerializer(message, context={"request": request}).data)


class MessageUnsendView(APIView):
    """Soft-delete (unsend) a message. Only the sender can unsend their own messages."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request, message_id: int) -> Response:
        message = get_object_or_404(Message, pk=message_id, sender=request.user)

        if message.is_system_message:
            return Response(
                {"detail": "Kan ikke slette denne besked"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message.is_deleted = True
        message.content = ""
        message.save()

        # Broadcast deletion via WebSocket
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"conversation_{message.conversation_id}",
            {
                "type": "message_deleted",
                "message_id": message.id,
                "conversation_id": message.conversation_id,
            },
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageReactionToggleView(APIView):
    """Toggle a reaction on a message. Only conversation participants can react."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, message_id: int) -> Response:
        message = get_object_or_404(Message, pk=message_id)

        # Verify user is a participant in the conversation
        if not message.conversation.participants.filter(id=request.user.id).exists():
            return Response(status=status.HTTP_403_FORBIDDEN)

        if message.is_deleted or message.is_system_message:
            return Response(
                {"detail": "Kan ikke reagere på denne besked"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reaction_type = (request.data.get("reaction_type") or "").strip()
        if not reaction_type or len(reaction_type) > 50:
            return Response(
                {"detail": "Ugyldig reaktionstype."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = MessageReaction.objects.filter(
            message=message, user=request.user, reaction_type=reaction_type
        ).first()
        if existing:
            existing.delete()
            action = "removed"
        else:
            MessageReaction.objects.create(
                message=message, user=request.user, reaction_type=reaction_type
            )
            action = "added"

            # Notify message author (skips if reactor == author)
            if message.sender_id != request.user.id:
                from apps.notifications.tasks import notify_message_reaction_task

                notify_message_reaction_task(
                    message_author_id=message.sender_id,
                    reactor_id=request.user.id,
                    reaction_emoji=reaction_type,
                    conversation_id=message.conversation_id,
                    message_id=message.id,
                )

        # Build updated reactions payload for WS broadcast
        reaction_map: dict[str, dict] = {}
        for r in MessageReaction.objects.filter(message=message).select_related("user"):
            if r.reaction_type not in reaction_map:
                reaction_map[r.reaction_type] = {
                    "reaction_type": r.reaction_type,
                    "emoji": r.reaction_type,
                    "count": 0,
                    "user_ids": [],
                    "users": [],
                }
            reaction_map[r.reaction_type]["count"] += 1
            reaction_map[r.reaction_type]["user_ids"].append(r.user.id)
            reaction_map[r.reaction_type]["users"].append(
                {
                    "id": r.user.id,
                    "first_name": r.user.first_name,
                    "last_name": r.user.last_name,
                }
            )

        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"conversation_{message.conversation_id}",
            {
                "type": "message_reacted",
                "message_id": message.id,
                "conversation_id": message.conversation_id,
                "reactions": list(reaction_map.values()),
            },
        )

        return Response({"action": action}, status=status.HTTP_200_OK)


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
