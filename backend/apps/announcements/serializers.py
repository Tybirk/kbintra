"""
Serializers for Announcements models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Announcement, AnnouncementAttachment


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for announcement authors."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class AnnouncementAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for AnnouncementAttachment model."""

    uploaded_by = AuthorSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = AnnouncementAttachment
        fields = [
            "id",
            "name",
            "file",
            "file_url",
            "preview_html",
            "uploaded_by",
            "uploaded_at",
        ]

    def get_file_url(self, obj: AnnouncementAttachment) -> str:
        if obj.file:
            return obj.file.url
        return ""


class AnnouncementSerializer(serializers.ModelSerializer):
    """Serializer for Announcement model."""

    author = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    attachments = AnnouncementAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content",
            "author",
            "is_active",
            "show_on_dashboard",
            "priority",
            "is_own",
            "can_edit",
            "attachments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    def get_is_own(self, obj: Announcement) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False

    def get_can_edit(self, obj: Announcement) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id or request.user.is_staff
        return False


class AnnouncementCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating announcements."""

    attachments = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Announcement
        fields = ["title", "content", "is_active", "show_on_dashboard", "priority", "attachments"]

    def validate_attachments(self, value: list) -> list:
        from apps.forum.utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def create(self, validated_data: dict) -> Announcement:
        attachments = validated_data.pop("attachments", [])
        validated_data["author"] = self.context["request"].user
        announcement = super().create(validated_data)

        # Create attachments
        from apps.forum.utils import generate_docx_preview

        for attachment_file in attachments:
            AnnouncementAttachment.objects.create(
                announcement=announcement,
                uploaded_by=announcement.author,
                file=attachment_file,
                name=attachment_file.name,
                preview_html=generate_docx_preview(attachment_file),
            )

        # Send notifications to all users (except author) if announcement is active
        if announcement.is_active:
            from apps.notifications.tasks import notify_new_announcement_task

            notify_new_announcement_task(
                author_id=announcement.author.id,
                announcement_title=announcement.title,
                announcement_id=announcement.id,
                announcement_content=announcement.content or "",
            )

        return announcement
