"""
Serializers for Messaging models.
"""

import logging
from collections import defaultdict
from datetime import UTC, datetime

from django.db.models import Max, Q
from rest_framework import serializers

from apps.backup.signing import signed_media_url
from apps.food.utils import house_number_for
from apps.forum.serializers import PollDataField, PollSerializer
from apps.forum.services import create_poll
from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Conversation, Message, MessageAttachment, MessageReadStatus

logger = logging.getLogger(__name__)


class ParticipantSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Minimal serializer for conversation participants."""

    house_number = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture", "house_number"]

    def get_house_number(self, obj: User) -> str:
        """ "22" for Kløverbakkevej 22, "" without a house: a chat without a name is
        titled by its people as "Lars (22), Mette (7)", like the madhold."""
        return house_number_for(obj.house)


# Sorts after any real time: participants who never wrote in a conversation.
_NEVER_ACTIVE = datetime.min.replace(tzinfo=UTC)


def last_active_by_sender(conversation_ids: list[int]) -> dict[int, dict[int, datetime]]:
    """When each participant last wrote in each conversation, in one query:
    {conversation_id: {user_id: created_at of their latest message}}."""
    last_active: dict[int, dict[int, datetime]] = defaultdict(dict)
    rows = (
        Message.objects.filter(conversation_id__in=conversation_ids)
        .values("conversation_id", "sender_id")
        .annotate(last=Max("created_at"))
        .values_list("conversation_id", "sender_id", "last")
    )
    for conversation_id, sender_id, last in rows:
        last_active[conversation_id][sender_id] = last
    return last_active


def message_attachment_preview_url(att: MessageAttachment) -> str:
    """URL for *viewing* an attachment: the converted web preview for formats the
    browser can't render (HEIC), otherwise the original file. Both signed."""
    if att.preview:
        return signed_media_url(att.preview.url)
    if att.file:
        return signed_media_url(att.file.url)
    return ""


def message_attachment_thumbnail_url(att: MessageAttachment) -> str:
    """URL for the chat bubble: the square thumbnail once it exists, until then
    whatever the bubble can display — the HEIC preview, else the original."""
    if att.thumbnail:
        return signed_media_url(att.thumbnail.url)
    return message_attachment_preview_url(att)


def poll_preview(poll) -> str:
    """How a poll message reads in the conversation list and in notifications."""
    return f"Afstemning: {poll.question}"[:100]


def create_message_attachment(
    message: Message, uploaded_by: User, attachment_file
) -> MessageAttachment:
    """Create a MessageAttachment together with its previews and thumbnail.

    All inline, not queued: the response and the WebSocket broadcast read
    `preview` and `thumbnail` straight away, and a queued task would not have
    run yet — every open chat would download the full original instead.
    """
    from apps.forum.image_processing import (
        ensure_attachment_preview,
        generate_attachment_thumbnail,
    )
    from apps.forum.utils import generate_docx_preview

    att = MessageAttachment.objects.create(
        message=message,
        file=attachment_file,
        name=attachment_file.name,
        uploaded_by=uploaded_by,
        preview_html=generate_docx_preview(attachment_file),
    )
    ensure_attachment_preview("messaging", "MessageAttachment", att)
    try:
        generate_attachment_thumbnail(att)
    except Exception:  # noqa: BLE001 — an upload must not fail over its thumbnail
        logger.exception("Thumbnail failed for message attachment %s", att.pk)
    return att


class MessageAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for MessageAttachment model."""

    file_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = [
            "id",
            "name",
            "file",
            "file_url",
            "preview_url",
            "thumbnail_url",
            "preview_html",
            "uploaded_at",
        ]
        read_only_fields = ["id", "uploaded_at"]

    def get_file_url(self, obj: MessageAttachment) -> str:
        return signed_media_url(obj.file.url) if obj.file else ""

    def get_preview_url(self, obj: MessageAttachment) -> str:
        return message_attachment_preview_url(obj)

    def get_thumbnail_url(self, obj: MessageAttachment) -> str:
        return message_attachment_thumbnail_url(obj)


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model."""

    sender = ParticipantSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()
    poll = serializers.SerializerMethodField()

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
            "poll",
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

    def get_poll(self, obj: Message) -> dict | None:
        # A missing reverse one-to-one raises DoesNotExist, which is an AttributeError.
        poll = getattr(obj, "poll", None)
        return PollSerializer(poll, context=self.context).data if poll else None

    def get_reactions(self, obj: Message) -> list:
        request = self.context.get("request")
        current_user_id = request.user.id if request and request.user.is_authenticated else None
        reaction_map: dict[str, dict] = {}
        for r in obj.reactions.all():
            if r.reaction_type not in reaction_map:
                reaction_map[r.reaction_type] = {
                    "reaction_type": r.reaction_type,
                    "emoji": r.reaction_type,
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
        """Check if message has been read by all other participants.

        When the caller supplies a precomputed ``read_status_map`` (and
        ``other_participant_ids``) in the context, this is resolved in memory —
        avoiding an N+1 of read-status count queries per message. Otherwise it
        falls back to per-message queries.
        """
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        current_user_id = request.user.id

        read_status_map = self.context.get("read_status_map")
        if read_status_map is not None:
            read_user_ids = read_status_map.get(obj.id, frozenset())
            if obj.sender_id == current_user_id:
                # Own message: read once every other participant has read it.
                other_ids = self.context.get("other_participant_ids", frozenset())
                return other_ids.issubset(read_user_ids)
            # Others' message: read if the current user has read it.
            return current_user_id in read_user_ids

        # Fallback: per-message queries (used by callers without precomputed context).
        if obj.sender_id == current_user_id:
            other_participants = obj.conversation.participants.exclude(id=current_user_id)
            read_count = obj.read_statuses.filter(user__in=other_participants).count()
            return read_count >= other_participants.count()
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
            "name",
            "participants",
            "other_participants",
            "last_message",
            "unread_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_other_participants(self, obj: Conversation) -> list:
        """Everyone but the reader, whoever wrote most recently first: the chat
        header and the list show them left to right in this order. People who
        haven't written yet come last."""
        request = self.context.get("request")
        if not (request and request.user.is_authenticated):
            return []
        batched = self.context.get("last_active")
        last_active = (
            batched.get(obj.id, {})
            if batched is not None
            else last_active_by_sender([obj.id])[obj.id]
        )
        others = [p for p in obj.participants.all() if p.id != request.user.id]
        # Stable, so people with the same (or no) last message keep their order.
        others.sort(key=lambda p: last_active.get(p.id, _NEVER_ACTIVE), reverse=True)
        return ParticipantSerializer(others, many=True).data

    def get_last_message(self, obj: Conversation) -> dict | None:
        last_messages = self.context.get("last_messages")
        if last_messages is not None:
            last_msg = last_messages.get(obj.id)
        else:
            last_msg = obj.messages.order_by("-created_at").first()
        if last_msg:
            # A message without text is a poll, an attachment, or one taken back:
            # the list showed an empty line for them.
            if last_msg.content:
                preview = last_msg.content[:100]
            elif last_msg.is_deleted:
                preview = "Besked slettet"
            elif poll := getattr(last_msg, "poll", None):
                preview = poll_preview(poll)
            else:
                preview = "(Vedhæftet fil)"
            return {
                "id": last_msg.id,
                "content": preview,
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


MESSAGE_PAGE_SIZE = 50


def message_page(conversation: Conversation, before: Message | None = None) -> tuple[list, bool]:
    """The newest MESSAGE_PAGE_SIZE messages, oldest first, and whether older ones exist.

    With `before`, the page ends just before that message, which is how the chat
    loads history one page at a time as the reader scrolls up.
    """
    messages = conversation.messages.select_related("sender__house", "poll").prefetch_related(
        "reactions__user", "attachments", "poll__options__votes__user"
    )
    if before is not None:
        messages = messages.filter(
            Q(created_at__lt=before.created_at) | Q(created_at=before.created_at, id__lt=before.id)
        )
    page = list(messages.order_by("-created_at", "-id")[: MESSAGE_PAGE_SIZE + 1])
    has_more = len(page) > MESSAGE_PAGE_SIZE
    page = page[:MESSAGE_PAGE_SIZE]
    page.reverse()
    return page, has_more


def serialize_messages(messages: list, conversation: Conversation, context: dict) -> list:
    """Serialize a page of messages without per-message queries: read status is
    precomputed in one query so MessageSerializer.is_read resolves in memory."""
    request = context.get("request")
    current_user_id = request.user.id if request and request.user.is_authenticated else None
    read_status_map: dict[int, set[int]] = defaultdict(set)
    if messages:
        for msg_id, user_id in MessageReadStatus.objects.filter(
            message_id__in=[m.id for m in messages]
        ).values_list("message_id", "user_id"):
            read_status_map[msg_id].add(user_id)
    other_participant_ids = {
        p.id for p in conversation.participants.all() if p.id != current_user_id
    }

    context = {
        **context,
        "read_status_map": read_status_map,
        "other_participant_ids": other_participant_ids,
    }
    return MessageSerializer(messages, many=True, context=context).data


class ConversationDetailSerializer(ConversationSerializer):
    """Detailed serializer with recent messages.

    The current frontend loads messages from the paginated message list instead;
    `messages` stays for one release so clients still running the previous bundle
    keep working until useVersionCheck reloads them. Remove it after that.
    """

    messages = serializers.SerializerMethodField()

    class Meta(ConversationSerializer.Meta):
        fields = ConversationSerializer.Meta.fields + ["messages"]

    def get_messages(self, obj: Conversation) -> list:
        messages, _ = message_page(obj)
        return serialize_messages(messages, obj, self.context)


class CreateConversationSerializer(serializers.Serializer):
    """Serializer for creating a new conversation."""

    participant_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=200,
    )
    # The first message, if any, comes as the fields of a message (content,
    # attachments, poll_data) and is sent by CreateMessageSerializer.
    #
    # Until 2026-11-13 its text came as initial_message. An app from before
    # then (it reloads itself within minutes) is asked to reload, rather than
    # having the text quietly dropped. Can go once no such app is left.
    initial_message = serializers.CharField(required=False, allow_blank=True)

    def validate_initial_message(self, value: str) -> str:
        if value.strip():
            raise serializers.ValidationError(
                "KB Intra er blevet opdateret. Genindlæs siden, og send beskeden igen."
            )
        return value

    def validate_participant_ids(self, value: list) -> list:
        request = self.context.get("request")
        if request and request.user.id in value:
            raise serializers.ValidationError("Du kan ikke tilføje dig selv som deltager.")
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
        max_length=200,
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
    poll_data = PollDataField(write_only=True, required=False)

    class Meta:
        model = Message
        fields = ["content", "attachments", "mentioned_user_ids", "poll_data"]

    def validate_attachments(self, value: list) -> list:
        from apps.forum.utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def validate(self, attrs: dict) -> dict:
        content = attrs.get("content", "").strip()
        attachments = attrs.get("attachments", [])
        if not content and not attachments and not attrs.get("poll_data"):
            raise serializers.ValidationError(
                "Beskeden skal indeholde tekst, en vedhæftet fil eller en afstemning."
            )
        return attrs

    def create(self, validated_data: dict) -> Message:
        """Send the message into `conversation`, given as save(conversation=...).

        Every message goes this way, the first one in a new conversation too: so
        it can be validated before that conversation exists.
        """
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        attachments = validated_data.pop("attachments", [])
        mentioned_user_ids = validated_data.pop("mentioned_user_ids", [])
        poll_data = validated_data.pop("poll_data", None)
        validated_data["sender"] = self.context["request"].user
        conversation = validated_data["conversation"]
        if mentioned_user_ids:
            # Only people in the conversation can be mentioned in it.
            participant_ids = set(conversation.participants.values_list("id", flat=True))
            mentioned_user_ids = [uid for uid in mentioned_user_ids if uid in participant_ids]
        message = super().create(validated_data)

        user = self.context["request"].user
        attachment_objects = [create_message_attachment(message, user, f) for f in attachments]
        poll = create_poll(poll_data, user, message=message) if poll_data else None

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
                "profile_picture": user.avatar_url,
            },
            "content": message.content,
            "is_own": False,  # Will be set correctly by the consumer
            "is_read": False,
            "is_system_message": message.is_system_message,
            "created_at": message.created_at.isoformat(),
            "attachments": MessageAttachmentSerializer(attachment_objects, many=True).data,
            # Nobody has voted yet, so one rendering fits every reader; the
            # consumer sets the poll's is_own per socket, like the message's.
            "poll": PollSerializer(poll).data if poll else None,
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
                    message_content=message.content or (poll_preview(poll) if poll else ""),
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
