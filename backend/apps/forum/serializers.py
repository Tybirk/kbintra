"""
Serializers for Forum models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import (
    File,
    Folder,
    Post,
    PostAttachment,
    Reaction,
    Subgroup,
    SubgroupSubscription,
    Thread,
)


class AuthorSerializer(serializers.ModelSerializer):
    """Minimal serializer for post/thread authors."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class PostAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for PostAttachment model."""

    uploaded_by = AuthorSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = PostAttachment
        fields = [
            "id",
            "name",
            "file",
            "file_url",
            "preview_html",
            "uploaded_by",
            "uploaded_at",
        ]

    def get_file_url(self, obj: PostAttachment) -> str:
        if obj.file:
            return obj.file.url
        return ""


class SubgroupSerializer(serializers.ModelSerializer):
    """Serializer for Subgroup model."""

    thread_count = serializers.SerializerMethodField()
    is_subscribed = serializers.SerializerMethodField()

    class Meta:
        model = Subgroup
        fields = [
            "id",
            "name",
            "description",
            "slug",
            "is_default",
            "is_committee",
            "is_main",
            "thread_count",
            "is_subscribed",
            "created_at",
            "last_activity_at",
        ]

    def get_thread_count(self, obj: Subgroup) -> int:
        return obj.threads.count()

    def get_is_subscribed(self, obj: Subgroup) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return SubgroupSubscription.objects.filter(user=request.user, subgroup=obj).exists()
        return False


class SubgroupSubscriptionSerializer(serializers.ModelSerializer):
    """Serializer for SubgroupSubscription model."""

    subgroup = SubgroupSerializer(read_only=True)

    class Meta:
        model = SubgroupSubscription
        fields = [
            "id",
            "subgroup",
            "notify_new_threads",
            "notify_replies",
            "created_at",
        ]


class ReactionSummarySerializer(serializers.Serializer):
    """Serializer for reaction summary (count per type)."""

    reaction_type = serializers.CharField()
    emoji = serializers.CharField()
    count = serializers.IntegerField()
    has_reacted = serializers.BooleanField()


class PostSerializer(serializers.ModelSerializer):
    """Serializer for Post model."""

    author = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    attachments = PostAttachmentSerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            "id",
            "thread",
            "author",
            "content",
            "is_own",
            "attachments",
            "reactions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "thread", "author", "created_at", "updated_at"]

    def get_is_own(self, obj: Post) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False

    def get_reactions(self, obj: Post) -> list[dict]:
        """Get reaction summary with counts and user's own reactions."""
        request = self.context.get("request")
        user_id = request.user.id if request and request.user.is_authenticated else None

        # Get all reactions for this post grouped by type
        reaction_counts: dict[str, dict] = {}
        emoji_map = dict(Reaction.REACTION_CHOICES)

        for reaction in obj.reactions.all():
            r_type = reaction.reaction_type
            if r_type not in reaction_counts:
                reaction_counts[r_type] = {
                    "reaction_type": r_type,
                    "emoji": emoji_map.get(r_type, ""),
                    "count": 0,
                    "has_reacted": False,
                }
            reaction_counts[r_type]["count"] += 1
            if user_id and reaction.user_id == user_id:
                reaction_counts[r_type]["has_reacted"] = True

        return list(reaction_counts.values())


class PostCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating posts with optional file attachments."""

    attachments = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Post
        fields = ["content", "attachments"]

    def create(self, validated_data: dict) -> Post:
        from django.utils import timezone

        from apps.notifications.services import notify_post_reply, notify_thread_reply

        from .utils import generate_docx_preview

        # Extract attachments before creating post
        attachments = validated_data.pop("attachments", [])

        validated_data["author"] = self.context["request"].user
        validated_data["thread"] = self.context["thread"]
        post = super().create(validated_data)

        # Create attachments
        for attachment_file in attachments:
            PostAttachment.objects.create(
                post=post,
                uploaded_by=post.author,
                file=attachment_file,
                name=attachment_file.name,
                preview_html=generate_docx_preview(attachment_file),
            )

        thread = post.thread
        author = post.author

        # Update subgroup's last activity timestamp
        thread.subgroup.last_activity_at = timezone.now()
        thread.subgroup.save(update_fields=["last_activity_at"])

        # Notify thread author (with full content for email)
        notify_thread_reply(
            thread_author=thread.author,
            replier=author,
            thread_title=thread.title,
            thread_id=thread.id,
            subgroup_slug=thread.subgroup.slug,
            reply_content=post.content,  # Full HTML content
        )

        # Notify other participants in the thread (previous posters)
        notified_users = {thread.author.id, author.id}
        previous_posters = (
            Post.objects.filter(thread=thread)
            .exclude(author=author)
            .values_list("author", flat=True)
            .distinct()
        )
        for poster_id in previous_posters:
            if poster_id not in notified_users:
                try:
                    poster = User.objects.get(id=poster_id)
                    notify_post_reply(
                        post_author=poster,
                        replier=author,
                        thread_title=thread.title,
                        thread_id=thread.id,
                        subgroup_slug=thread.subgroup.slug,
                        reply_content=post.content,  # Full HTML content
                    )
                    notified_users.add(poster_id)
                except User.DoesNotExist:
                    pass

        return post


class ThreadSerializer(serializers.ModelSerializer):
    """Serializer for Thread model (list view)."""

    author = AuthorSerializer(read_only=True)
    post_count = serializers.SerializerMethodField()
    last_post_at = serializers.SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "subgroup",
            "title",
            "author",
            "is_pinned",
            "post_count",
            "last_post_at",
            "created_at",
            "updated_at",
        ]

    def get_post_count(self, obj: Thread) -> int:
        return obj.posts.count()

    def get_last_post_at(self, obj: Thread) -> str | None:
        last_post = obj.posts.order_by("-created_at").first()
        if last_post:
            return last_post.created_at.isoformat()
        return None


class ThreadDetailSerializer(serializers.ModelSerializer):
    """Serializer for Thread model (detail view with posts)."""

    author = AuthorSerializer(read_only=True)
    posts = PostSerializer(many=True, read_only=True)
    subgroup_name = serializers.CharField(source="subgroup.name", read_only=True)
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "subgroup",
            "subgroup_name",
            "title",
            "author",
            "is_pinned",
            "is_own",
            "posts",
            "created_at",
            "updated_at",
        ]

    def get_is_own(self, obj: Thread) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False


class ThreadCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating threads with initial post."""

    content = serializers.CharField(write_only=True)
    attachments = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Thread
        fields = ["title", "content", "attachments"]

    def create(self, validated_data: dict) -> Thread:
        from django.utils import timezone

        from apps.notifications.services import notify_new_thread

        from .utils import generate_docx_preview

        content = validated_data.pop("content")
        attachments = validated_data.pop("attachments", [])
        validated_data["author"] = self.context["request"].user
        validated_data["subgroup"] = self.context["subgroup"]

        thread = super().create(validated_data)

        # Create the initial post
        post = Post.objects.create(
            thread=thread,
            author=self.context["request"].user,
            content=content,
        )

        # Create attachments for the initial post
        for attachment_file in attachments:
            PostAttachment.objects.create(
                post=post,
                uploaded_by=post.author,
                file=attachment_file,
                name=attachment_file.name,
                preview_html=generate_docx_preview(attachment_file),
            )

        # Update subgroup's last activity timestamp
        thread.subgroup.last_activity_at = timezone.now()
        thread.subgroup.save(update_fields=["last_activity_at"])

        # Notify subscribers of the subgroup (with full content for email)
        subscribers = User.objects.filter(
            subgroup_subscriptions__subgroup=thread.subgroup,
            subgroup_subscriptions__notify_new_threads=True,
        )
        notify_new_thread(
            subscribers=subscribers,
            author=thread.author,
            thread_title=thread.title,
            thread_id=thread.id,
            subgroup_name=thread.subgroup.name,
            subgroup_slug=thread.subgroup.slug,
            initial_post_content=content,  # Full HTML content
        )

        return thread


class FolderSerializer(serializers.ModelSerializer):
    """Serializer for Folder model."""

    file_count = serializers.SerializerMethodField()
    subfolder_count = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = [
            "id",
            "name",
            "parent",
            "file_count",
            "subfolder_count",
            "created_at",
        ]

    def get_file_count(self, obj: Folder) -> int:
        return obj.files.count()

    def get_subfolder_count(self, obj: Folder) -> int:
        return obj.children.count()


class FolderCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating folders."""

    class Meta:
        model = Folder
        fields = ["name", "parent"]

    def create(self, validated_data: dict) -> Folder:
        validated_data["subgroup"] = self.context["subgroup"]
        return super().create(validated_data)


class FileSerializer(serializers.ModelSerializer):
    """Serializer for File model."""

    uploaded_by = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = File
        fields = [
            "id",
            "name",
            "file",
            "file_url",
            "preview_html",
            "uploaded_by",
            "is_own",
            "uploaded_at",
        ]

    def get_is_own(self, obj: File) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.uploaded_by_id == request.user.id
        return False

    def get_file_url(self, obj: File) -> str:
        if obj.file:
            return obj.file.url
        return ""


class FileUploadSerializer(serializers.ModelSerializer):
    """Serializer for uploading files."""

    name = serializers.CharField(max_length=255, required=False, allow_blank=True)

    class Meta:
        model = File
        fields = ["file", "name"]

    def create(self, validated_data: dict) -> File:
        from .utils import generate_docx_preview

        validated_data["uploaded_by"] = self.context["request"].user
        validated_data["folder"] = self.context.get("folder")
        validated_data["subgroup"] = self.context["subgroup"]
        # Use filename if name not provided or is empty
        name = validated_data.get("name", "").strip()
        if not name:
            validated_data["name"] = validated_data["file"].name
        # Generate DOCX preview if applicable
        validated_data["preview_html"] = generate_docx_preview(validated_data["file"])
        return super().create(validated_data)


class RecentActivitySerializer(serializers.ModelSerializer):
    """Serializer for recent forum activity (posts with thread/subgroup context)."""

    author = AuthorSerializer(read_only=True)
    thread_id = serializers.IntegerField(source="thread.id", read_only=True)
    thread_title = serializers.CharField(source="thread.title", read_only=True)
    subgroup_slug = serializers.CharField(source="thread.subgroup.slug", read_only=True)
    subgroup_name = serializers.CharField(source="thread.subgroup.name", read_only=True)

    class Meta:
        model = Post
        fields = [
            "id",
            "author",
            "content",
            "thread_id",
            "thread_title",
            "subgroup_slug",
            "subgroup_name",
            "created_at",
        ]
