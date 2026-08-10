"""
Models for Messaging app.
"""

from django.conf import settings
from django.db import models

from .encryption import EncryptedTextField


class Conversation(models.Model):
    """A conversation between two or more users."""

    name = models.CharField(max_length=100, blank=True, default="")
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="conversations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        participant_names = ", ".join([p.first_name for p in self.participants.all()[:3]])
        return f"Conversation: {participant_names}"

    def get_other_participants(self, user):
        """Get participants excluding the given user."""
        return self.participants.exclude(id=user.id)


class Message(models.Model):
    """A message within a conversation."""

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
    )
    content = EncryptedTextField()
    is_system_message = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            # Speeds up UnreadCountView's anti-join: WHERE conversation_id=? AND sender_id<>?
            # then a NOT EXISTS against MessageReadStatus.
            models.Index(fields=["conversation", "sender"], name="msg_conv_sender_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.sender.first_name}: {self.content[:50]}"


class MessageReadStatus(models.Model):
    """Tracks read status of messages per user."""

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="read_statuses",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="message_read_statuses",
    )
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["message", "user"]
        indexes = [
            # The unique_together gives an index keyed (message, user); the unread
            # count's NOT EXISTS subquery seeks by (user, message), so add the
            # mirror index.
            models.Index(fields=["user", "message"], name="msg_read_user_msg_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user.first_name} read message {self.message.id}"


class MessageReaction(models.Model):
    """A reaction (emoji) on a message."""

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="reactions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="message_reactions",
    )
    reaction_type = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user", "reaction_type"],
                name="unique_message_reaction_per_user",
            ),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.user} reacted {self.reaction_type} to message {self.message_id}"


class MessageAttachment(models.Model):
    """A file attachment on a message."""

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="message_attachments/")
    preview = models.ImageField(
        upload_to="message_attachments/previews/",
        blank=True,
        null=True,
        help_text="Full-size web-viewable JPEG for formats browsers can't render (e.g. HEIC).",
    )
    name = models.CharField(max_length=255)
    preview_html = models.TextField(blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="message_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Attachment: {self.name}"

    def delete(self, *args, **kwargs):
        """Delete the file from storage when the model is deleted."""
        if self.file:
            self.file.delete(save=False)
        if self.preview:
            self.preview.delete(save=False)
        super().delete(*args, **kwargs)
