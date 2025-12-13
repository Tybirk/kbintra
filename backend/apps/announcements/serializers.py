"""
Serializers for Announcements models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import Announcement


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for announcement authors."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class AnnouncementSerializer(serializers.ModelSerializer):
    """Serializer for Announcement model."""

    author = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "content",
            "author",
            "is_active",
            "priority",
            "is_own",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]

    def get_is_own(self, obj: Announcement) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False


class AnnouncementCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating announcements."""

    class Meta:
        model = Announcement
        fields = ["title", "content", "is_active", "priority"]

    def create(self, validated_data: dict) -> Announcement:
        from apps.notifications.services import notify_new_announcement

        validated_data["author"] = self.context["request"].user
        announcement = super().create(validated_data)

        # Send notifications to all users if announcement is active
        if announcement.is_active:
            notify_new_announcement(
                recipients=User.objects.all(),
                author=announcement.author,
                announcement_title=announcement.title,
                announcement_id=announcement.id,
                announcement_content=announcement.content,  # Full HTML content
            )

        return announcement
