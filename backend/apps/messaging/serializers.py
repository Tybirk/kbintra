"""
Serializers for Messaging models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Conversation, Message, MessageAttachment


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
        fields = ["id", "name", "file", "file_url", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]

    def get_file_url(self, obj: MessageAttachment) -> str:
        return obj.file.url if obj.file else ""


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model."""

    sender = ParticipantSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "conversation",
            "sender",
            "content",
            "is_own",
            "is_read",
            "created_at",
            "attachments",
        ]
        read_only_fields = ["id", "sender", "created_at"]

    def get_is_own(self, obj: Message) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.sender_id == request.user.id
        return False

    def get_is_read(self, obj: Message) -> bool:
        """Check if message has been read by all other participants."""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        # For own messages, check if others have read it
        if obj.sender_id == request.user.id:
            other_participants = obj.conversation.participants.exclude(
                id=request.user.id
            )
            read_count = obj.read_statuses.filter(
                user__in=other_participants
            ).count()
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
            others = obj.participants.exclude(id=request.user.id)
            return ParticipantSerializer(others, many=True).data
        return []

    def get_last_message(self, obj: Conversation) -> dict | None:
        last_msg = obj.messages.order_by("-created_at").first()
        if last_msg:
            return {
                "id": last_msg.id,
                "content": last_msg.content[:100],
                "sender_id": last_msg.sender_id,
                "created_at": last_msg.created_at.isoformat(),
            }
        return None

    def get_unread_count(self, obj: Conversation) -> int:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return 0
        # Count messages from others that user hasn't read
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
        messages = obj.messages.select_related("sender").order_by("-created_at")[:50]
        # Reverse to show oldest first
        messages = list(reversed(messages))
        return MessageSerializer(
            messages, many=True, context=self.context
        ).data


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

    def validate_participant_ids(self, value: list) -> list:
        request = self.context.get("request")
        if request and request.user.id in value:
            raise serializers.ValidationError(
                "Cannot include yourself in participant_ids"
            )
        # Verify all users exist
        existing_ids = set(
            User.objects.filter(id__in=value).values_list("id", flat=True)
        )
        invalid_ids = set(value) - existing_ids
        if invalid_ids:
            raise serializers.ValidationError(
                f"Users with ids {invalid_ids} do not exist"
            )
        return value


class CreateMessageSerializer(serializers.ModelSerializer):
    """Serializer for creating a new message."""

    content = serializers.CharField(required=False, allow_blank=True, default="")
    attachments = serializers.ListField(
        child=serializers.FileField(),
        required=False,
        write_only=True,
    )

    class Meta:
        model = Message
        fields = ["content", "attachments"]

    def validate(self, attrs: dict) -> dict:
        content = attrs.get("content", "").strip()
        attachments = attrs.get("attachments", [])
        if not content and not attachments:
            raise serializers.ValidationError(
                "Message must have content or attachments."
            )
        return attrs

    def create(self, validated_data: dict) -> Message:
        from apps.notifications.services import notify_new_message

        attachments = validated_data.pop("attachments", [])
        validated_data["sender"] = self.context["request"].user
        validated_data["conversation"] = self.context["conversation"]
        message = super().create(validated_data)

        # Create attachments
        user = self.context["request"].user
        for attachment_file in attachments:
            MessageAttachment.objects.create(
                message=message,
                file=attachment_file,
                name=attachment_file.name,
                uploaded_by=user,
            )

        # Update conversation's updated_at
        message.conversation.save()

        # Send notifications to other participants
        sender = message.sender
        for participant in message.conversation.participants.exclude(id=sender.id):
            notify_new_message(
                recipient=participant,
                sender=sender,
                message_content=message.content,
                conversation_id=message.conversation.id,
            )

        return message
