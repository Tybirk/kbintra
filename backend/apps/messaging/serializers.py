"""
Serializers for Messaging models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Conversation, Message, MessageAttachment, MessageReaction


class ParticipantSerializer(serializers.ModelSerializer):
    """Minimal serializer for conversation participants."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class MessageAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for MessageAttachment model."""

    file_url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ["id", "name", "file", "file_url", "preview_html", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]

    def get_file_url(self, obj: MessageAttachment) -> str:
        return obj.file.url if obj.file else ""


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model."""

    sender = ParticipantSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "conversation",
            "sender",
            "content",
            "is_own",
            "is_read",
            "is_system_message",
            "is_deleted",
            "edited_at",
            "created_at",
            "attachments",
            "reactions",
        ]
        read_only_fields = [
            "id",
            "sender",
            "created_at",
            "is_system_message",
            "is_deleted",
            "edited_at",
        ]

    def get_is_own(self, obj: Message) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.sender_id == request.user.id
        return False

    def get_reactions(self, obj: Message) -> list:
        request = self.context.get("request")
        current_user_id = request.user.id if request and request.user.is_authenticated else None
        emoji_map = dict(MessageReaction.REACTION_CHOICES)
        reaction_map: dict[str, dict] = {}
        for r in obj.reactions.all():
            if r.reaction_type not in reaction_map:
                reaction_map[r.reaction_type] = {
                    "reaction_type": r.reaction_type,
                    "emoji": emoji_map.get(r.reaction_type, ""),
                    "count": 0,
                    "has_reacted": False,
                    "users": [],
                }
            reaction_map[r.reaction_type]["count"] += 1
            reaction_map[r.reaction_type]["users"].append(
                {
                    "id": r.user.id,
                    "first_name": r.user.first_name,
                    "last_name": r.user.last_name,
                }
            )
            if current_user_id and r.user_id == current_user_id:
                reaction_map[r.reaction_type]["has_reacted"] = True
        return list(reaction_map.values())

    def get_is_read(self, obj: Message) -> bool:
        """Check if message has been read by all other participants."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        # For own messages, check if others have read it
        if obj.sender_id == request.user.id:
            other_participants = obj.conversation.participants.exclude(id=request.user.id)
            read_count = obj.read_statuses.filter(user__in=other_participants).count()
            return read_count >= other_participants.count()
        # For others' messages, check if current user has read it
        return obj.read_statuses.filter(user=request.user).exists()


class ConversationSerializer(serializers.ModelSerializer):
    """Serializer for Conversation model."""

    participants = ParticipantSerializer(many=True, read_only=True)
    other_participants = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id",
            "participants",
            "other_participants",
            "last_message",
            "unread_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_other_participants(self, obj: Conversation) -> list:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            others = [p for p in obj.participants.all() if p.id != request.user.id]
            return ParticipantSerializer(others, many=True).data
        return []

    def get_last_message(self, obj: Conversation) -> dict | None:
        last_messages = self.context.get("last_messages")
        if last_messages is not None:
            last_msg = last_messages.get(obj.id)
        else:
            last_msg = obj.messages.order_by("-created_at").first()
        if last_msg:
            return {
                "id": last_msg.id,
                "content": last_msg.content[:100] if last_msg.content else "",
                "sender_id": last_msg.sender_id,
                "created_at": last_msg.created_at.isoformat(),
            }
        return None

    def get_unread_count(self, obj: Conversation) -> int:
        unread_counts = self.context.get("unread_counts")
        if unread_counts is not None:
            return unread_counts.get(obj.id, 0)
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        return (
            obj.messages.exclude(sender=request.user)
            .exclude(read_statuses__user=request.user)
            .count()
        )


class ConversationDetailSerializer(ConversationSerializer):
    """Detailed serializer with recent messages."""

    messages = serializers.SerializerMethodField()

    class Meta(ConversationSerializer.Meta):
        fields = ConversationSerializer.Meta.fields + ["messages"]

    def get_messages(self, obj: Conversation) -> list:
        # Get last 50 messages
        messages = (
            obj.messages.select_related("sender")
            .prefetch_related("reactions__user")
            .order_by("-created_at")[:50]
        )
        # Reverse to show oldest first
        messages = list(reversed(messages))
        return MessageSerializer(messages, many=True, context=self.context).data


class CreateConversationSerializer(serializers.Serializer):
    """Serializer for creating a new conversation."""

    participant_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=10,
    )
    initial_message = serializers.CharField(required=False, allow_blank=True)
    attachments = serializers.ListField(
        child=serializers.FileField(),
        required=False,
    )

    def validate_attachments(self, value: list) -> list:
        from apps.forum.utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def validate_participant_ids(self, value: list) -> list:
        request = self.context.get("request")
        if request and request.user.id in value:
            raise serializers.ValidationError("Cannot include yourself in participant_ids")
        # Verify all users exist
        existing_ids = set(User.objects.filter(id__in=value).values_list("id", flat=True))
        invalid_ids = set(value) - existing_ids
        if invalid_ids:
            raise serializers.ValidationError(f"Users with ids {invalid_ids} do not exist")
        return value


class AddParticipantsSerializer(serializers.Serializer):
    """Serializer for adding participants to an existing conversation."""

    user_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=10,
    )

    def validate_user_ids(self, value: list) -> list:
        # Verify all users exist
        existing_ids = set(User.objects.filter(id__in=value).values_list("id", flat=True))
        invalid_ids = set(value) - existing_ids
        if invalid_ids:
            raise serializers.ValidationError(f"Users with ids {invalid_ids} do not exist")
        return value


class CreateMessageSerializer(serializers.ModelSerializer):
    """Serializer for creating a new message."""

    content = serializers.CharField(required=False, allow_blank=True, default="")
    attachments = serializers.ListField(
        child=serializers.FileField(),
        required=False,
        write_only=True,
    )
    mentioned_user_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
        default=list,
    )

    class Meta:
        model = Message
        fields = ["content", "attachments", "mentioned_user_ids"]

    def validate_attachments(self, value: list) -> list:
        from apps.forum.utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def validate(self, attrs: dict) -> dict:
        content = attrs.get("content", "").strip()
        attachments = attrs.get("attachments", [])
        if not content and not attachments:
            raise serializers.ValidationError("Message must have content or attachments.")

        # Filter mentioned_user_ids to only include actual conversation participants
        mentioned_ids = attrs.get("mentioned_user_ids", [])
        if mentioned_ids:
            conversation = self.context.get("conversation")
            if conversation:
                participant_ids = set(conversation.participants.values_list("id", flat=True))
                attrs["mentioned_user_ids"] = [
                    uid for uid in mentioned_ids if uid in participant_ids
                ]

        return attrs

    def create(self, validated_data: dict) -> Message:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        attachments = validated_data.pop("attachments", [])
        mentioned_user_ids = validated_data.pop("mentioned_user_ids", [])
        validated_data["sender"] = self.context["request"].user
        validated_data["conversation"] = self.context["conversation"]
        message = super().create(validated_data)

        # Create attachments
        from apps.forum.utils import generate_docx_preview, generate_pdf_preview

        user = self.context["request"].user
        attachment_objects = []
        for attachment_file in attachments:
            att = MessageAttachment.objects.create(
                message=message,
                file=attachment_file,
                name=attachment_file.name,
                uploaded_by=user,
                preview_html=generate_docx_preview(attachment_file)
                or generate_pdf_preview(attachment_file),
            )
            attachment_objects.append(att)

        # Update conversation's updated_at
        message.conversation.save()

        # Broadcast message via WebSocket to all participants
        channel_layer = get_channel_layer()
        message_data = {
            "id": message.id,
            "conversation": message.conversation.id,
            "sender": {
                "id": user.id,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "profile_picture": user.profile_picture.url if user.profile_picture else None,
            },
            "content": message.content,
            "is_own": False,  # Will be set correctly by the consumer
            "is_read": False,
            "is_system_message": message.is_system_message,
            "created_at": message.created_at.isoformat(),
            "attachments": [
                {
                    "id": att.id,
                    "name": att.name,
                    "file_url": att.file.url if att.file else "",
                    "preview_html": att.preview_html,
                }
                for att in attachment_objects
            ],
        }
        async_to_sync(channel_layer.group_send)(
            f"conversation_{message.conversation.id}",
            {
                "type": "chat_message",
                "message": message_data,
            },
        )

        # Send notifications to other participants in background.
        # Mentioned users get a mention notification instead (higher priority).
        from apps.notifications.tasks import notify_new_message_task

        sender = message.sender
        mentioned_set = set(mentioned_user_ids)
        for participant in message.conversation.participants.exclude(id=sender.id):
            if participant.id not in mentioned_set:
                notify_new_message_task(
                    recipient_id=participant.id,
                    sender_id=sender.id,
                    message_content=message.content,
                    conversation_id=message.conversation.id,
                    message_id=message.id,
                )

        # Send mention notifications (these take precedence over new_message)
        if mentioned_user_ids:
            from apps.notifications.tasks import notify_mentions_task

            notify_mentions_task(
                author_id=sender.id,
                mentioned_user_ids=mentioned_user_ids,
                context_label="en besked",
                link=f"/beskeder/{message.conversation.id}#msg-{message.id}",
            )

        return message
