"""
Serializers for Forum models.
"""

from rest_framework import serializers

from apps.users.models import User

from .models import (
    File,
    Folder,
    Poll,
    PollOption,
    PollVote,
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
        fields = ["id", "first_name", "last_name", "profile_picture", "phone_number"]


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
    unread_thread_count = serializers.SerializerMethodField()

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
            "unread_thread_count",
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

    def get_unread_thread_count(self, obj: Subgroup) -> int:
        read_status_map = self.context.get("read_status_map")
        if read_status_map is None:
            return 0
        count = 0
        for thread in obj.threads.all():
            last_read = read_status_map.get(thread.id)
            if last_read is None or thread.updated_at > last_read:
                count += 1
        return count


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
    users = serializers.ListField(child=serializers.DictField())


class PollVoterSerializer(serializers.ModelSerializer):
    """Minimal serializer for poll voters."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class PollOptionSerializer(serializers.ModelSerializer):
    """Serializer for PollOption with vote info."""

    vote_count = serializers.SerializerMethodField()
    has_voted = serializers.SerializerMethodField()
    voters = serializers.SerializerMethodField()

    class Meta:
        model = PollOption
        fields = ["id", "text", "order", "vote_count", "has_voted", "voters"]

    def get_vote_count(self, obj: PollOption) -> int:
        return obj.votes.count()

    def get_has_voted(self, obj: PollOption) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.votes.filter(user=request.user).exists()
        return False

    def get_voters(self, obj: PollOption) -> list[dict]:
        if obj.poll.is_anonymous:
            return []
        voters = [vote.user for vote in obj.votes.all()]
        return PollVoterSerializer(voters, many=True).data


class PollSerializer(serializers.ModelSerializer):
    """Serializer for Poll with options and vote data."""

    options = PollOptionSerializer(many=True, read_only=True)
    total_voters = serializers.SerializerMethodField()
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = Poll
        fields = [
            "id",
            "question",
            "allow_multiple_votes",
            "is_anonymous",
            "options",
            "total_voters",
            "is_own",
            "created_at",
        ]

    def get_total_voters(self, obj: Poll) -> int:
        return PollVote.objects.filter(option__poll=obj).values("user_id").distinct().count()

    def get_is_own(self, obj: Poll) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.created_by_id == request.user.id
        return False


class PollOptionCreateSerializer(serializers.Serializer):
    """Serializer for creating a poll option."""

    text = serializers.CharField(max_length=200)


class PollCreateSerializer(serializers.Serializer):
    """Serializer for creating a poll."""

    question = serializers.CharField(max_length=300)
    allow_multiple_votes = serializers.BooleanField(default=False)
    is_anonymous = serializers.BooleanField(default=False)
    options = PollOptionCreateSerializer(many=True)

    def validate_options(self, value: list) -> list:
        if len(value) < 2:
            raise serializers.ValidationError("A poll must have at least 2 options.")
        if len(value) > 20:
            raise serializers.ValidationError("A poll can have at most 20 options.")
        return value


class PollOptionUpdateSerializer(serializers.Serializer):
    """Serializer for an option in a poll update request."""

    id = serializers.IntegerField(required=False, allow_null=True)
    text = serializers.CharField(max_length=200)


class PollUpdateSerializer(serializers.Serializer):
    """Serializer for updating a poll."""

    question = serializers.CharField(max_length=300, required=False)
    allow_multiple_votes = serializers.BooleanField(required=False)
    is_anonymous = serializers.BooleanField(required=False)
    options = PollOptionUpdateSerializer(many=True, required=False)

    def validate_options(self, value: list) -> list:
        if len(value) < 2:
            raise serializers.ValidationError("En afstemning skal have mindst 2 valgmuligheder.")
        if len(value) > 20:
            raise serializers.ValidationError("En afstemning kan højst have 20 valgmuligheder.")
        return value


class PostSerializer(serializers.ModelSerializer):
    """Serializer for Post model."""

    author = AuthorSerializer(read_only=True)
    is_own = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    attachments = PostAttachmentSerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()
    poll = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            "id",
            "thread",
            "author",
            "content",
            "is_own",
            "can_edit",
            "attachments",
            "reactions",
            "poll",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "thread", "author", "created_at", "updated_at"]

    def get_poll(self, obj: Post) -> dict | None:
        try:
            poll = obj.poll
        except Poll.DoesNotExist:
            return None
        return PollSerializer(poll, context=self.context).data

    def get_is_own(self, obj: Post) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False

    def get_can_edit(self, obj: Post) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id or request.user.is_staff
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
                    "users": [],
                }
            reaction_counts[r_type]["count"] += 1
            if user_id and reaction.user_id == user_id:
                reaction_counts[r_type]["has_reacted"] = True
            reaction_counts[r_type]["users"].append(
                {
                    "id": reaction.user.id,
                    "first_name": reaction.user.first_name,
                    "last_name": reaction.user.last_name,
                    "profile_picture": reaction.user.profile_picture.url
                    if reaction.user.profile_picture
                    else None,
                }
            )

        return list(reaction_counts.values())


class PostCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating posts with optional file attachments."""

    attachments = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )
    poll_data = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Post
        fields = ["content", "attachments", "poll_data"]
        extra_kwargs = {"content": {"allow_blank": True}}

    def validate(self, attrs: dict) -> dict:
        # On update the post already exists (self.instance is set), so the
        # "must have content, file, or poll" constraint does not apply —
        # the existing poll or attachments continue to satisfy it.
        if self.instance is not None:
            return attrs
        content = attrs.get("content", "").strip()
        attachments = attrs.get("attachments", [])
        poll_data = attrs.get("poll_data")
        if not content and not attachments and poll_data is None:
            raise serializers.ValidationError(
                "Et indlæg skal have indhold, en fil eller en afstemning."
            )
        return attrs

    def validate_attachments(self, value: list) -> list:
        from .utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def validate_poll_data(self, value: object) -> dict:
        if value is None:
            return value
        serializer = PollCreateSerializer(data=value)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def create(self, validated_data: dict) -> Post:
        from django.utils import timezone

        from apps.notifications.tasks import (
            notify_post_reply_task,
            notify_subgroup_activity_task,
            notify_thread_reply_task,
        )

        from .utils import generate_docx_preview

        # Extract poll_data and attachments before creating post
        poll_data = validated_data.pop("poll_data", None)
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

        # Create poll if poll_data is provided
        if poll_data:
            poll = Poll.objects.create(
                post=post,
                question=poll_data["question"],
                allow_multiple_votes=poll_data.get("allow_multiple_votes", False),
                is_anonymous=poll_data.get("is_anonymous", False),
                created_by=post.author,
            )
            for i, option_data in enumerate(poll_data["options"]):
                PollOption.objects.create(poll=poll, text=option_data["text"], order=i)

        thread = post.thread
        author = post.author

        # Update subgroup's last activity timestamp
        thread.subgroup.last_activity_at = timezone.now()
        thread.subgroup.save(update_fields=["last_activity_at"])

        # Extract mention IDs — mentioned users get mention notifications (higher priority)
        # instead of generic reply notifications, so skip them here.
        from apps.notifications.utils import extract_mention_ids

        mentioned_ids = set(extract_mention_ids(post.content)) if post.content else set()

        # Only exclude mentioned users who will actually receive MENTION.
        # Users with notify_mentions=False won't get MENTION, so they should fall back
        # to lower-priority notifications (thread_reply, post_reply, subgroup_activity).
        mentioned_who_opt_out = set(
            User.objects.filter(
                id__in=mentioned_ids,
                notification_preferences__notify_mentions=False,
            ).values_list("id", flat=True)
        )
        effective_mentioned_ids = mentioned_ids - mentioned_who_opt_out

        # Notify thread author in background
        # thread.author can be None if the original author was deleted
        if thread.author is not None and thread.author.id not in effective_mentioned_ids:
            notify_thread_reply_task(
                thread_author_id=thread.author.id,
                replier_id=author.id,
                thread_title=thread.title,
                thread_id=thread.id,
                subgroup_slug=thread.subgroup.slug,
                thread_slug=thread.slug,
                reply_content=post.content,
                post_id=post.id,
            )

        # Notify other participants in the thread (previous posters)
        # Handle None thread author case
        notified_users = {author.id}
        if thread.author is not None:
            notified_users.add(thread.author.id)
        previous_posters = (
            Post.objects.filter(thread=thread)
            .exclude(author=author)
            .values_list("author", flat=True)
            .distinct()
        )
        for poster_id in previous_posters:
            if poster_id is not None and poster_id not in notified_users:
                if poster_id not in effective_mentioned_ids:
                    notify_post_reply_task(
                        post_author_id=poster_id,
                        replier_id=author.id,
                        thread_title=thread.title,
                        thread_id=thread.id,
                        subgroup_slug=thread.subgroup.slug,
                        thread_slug=thread.slug,
                        reply_content=post.content,
                        post_id=post.id,
                    )
                notified_users.add(poster_id)

        # Notify subgroup subscribers who haven't participated in this thread.
        # Pass participant_ids separately so the task can determine which participants
        # will actually receive THREAD_REPLY/POST_REPLY (those with notify_thread_replies=True
        # or no prefs). Participants who opted out of thread_replies will fall back here.
        notify_subgroup_activity_task(
            replier_id=author.id,
            thread_title=thread.title,
            thread_id=thread.id,
            subgroup_id=thread.subgroup.id,
            subgroup_name=thread.subgroup.name,
            subgroup_slug=thread.subgroup.slug,
            thread_slug=thread.slug,
            reply_content=post.content,
            post_id=post.id,
            participant_ids=list(notified_users),
            mentioned_ids=list(effective_mentioned_ids),
        )

        # Store mention IDs for the view's perform_create to send mention notifications
        post._mention_ids = list(mentioned_ids)

        return post


class ThreadSerializer(serializers.ModelSerializer):
    """Serializer for Thread model (list view)."""

    author = AuthorSerializer(read_only=True)
    post_count = serializers.SerializerMethodField()
    last_post_at = serializers.SerializerMethodField()
    last_post_author = serializers.SerializerMethodField()
    is_unread = serializers.SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "subgroup",
            "title",
            "slug",
            "author",
            "is_pinned",
            "is_closed",
            "post_count",
            "last_post_at",
            "last_post_author",
            "is_unread",
            "created_at",
            "updated_at",
        ]

    def get_post_count(self, obj: Thread) -> int:
        return obj.posts.count()

    def _get_last_post(self, obj: Thread) -> Post | None:
        cache = getattr(self, "_last_post_cache", None)
        if cache is None:
            self._last_post_cache = cache = {}
        if obj.id not in cache:
            cache[obj.id] = obj.posts.select_related("author").order_by("-created_at").first()
        return cache[obj.id]

    def get_last_post_at(self, obj: Thread) -> str | None:
        last_post = self._get_last_post(obj)
        if last_post:
            return last_post.created_at.isoformat()
        return None

    def get_last_post_author(self, obj: Thread) -> dict[str, object] | None:
        last_post = self._get_last_post(obj)
        if last_post:
            return AuthorSerializer(last_post.author).data
        return None

    def get_is_unread(self, obj: Thread) -> bool:
        unread_thread_ids = self.context.get("unread_thread_ids")
        if unread_thread_ids is None:
            return False
        return obj.id in unread_thread_ids


class ThreadDetailSerializer(serializers.ModelSerializer):
    """Serializer for Thread model (detail view with posts)."""

    author = AuthorSerializer(read_only=True)
    posts = PostSerializer(many=True, read_only=True)
    subgroup_name = serializers.CharField(source="subgroup.name", read_only=True)
    subgroup_slug = serializers.CharField(source="subgroup.slug", read_only=True)
    is_own = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_close = serializers.SerializerMethodField()
    event_id = serializers.SerializerMethodField()
    event_slug = serializers.SerializerMethodField()
    is_muted = serializers.SerializerMethodField()

    class Meta:
        model = Thread
        fields = [
            "id",
            "subgroup",
            "subgroup_name",
            "subgroup_slug",
            "title",
            "slug",
            "author",
            "is_pinned",
            "is_closed",
            "is_own",
            "can_edit",
            "can_close",
            "is_muted",
            "event_id",
            "event_slug",
            "posts",
            "created_at",
            "updated_at",
        ]

    def get_is_own(self, obj: Thread) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id
        return False

    def get_can_edit(self, obj: Thread) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id or request.user.is_staff
        return False

    def get_can_close(self, obj: Thread) -> bool:
        """Check if current user can close/reopen this thread (owner or admin)."""
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.id or request.user.is_staff
        return False

    def get_is_muted(self, obj: Thread) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            from .models import ThreadMuteStatus

            return ThreadMuteStatus.objects.filter(user=request.user, thread=obj).exists()
        return False

    def get_event_id(self, obj: Thread) -> int | None:
        try:
            return obj.event.id
        except AttributeError:
            return None

    def get_event_slug(self, obj: Thread) -> str | None:
        try:
            return obj.event.slug
        except AttributeError:
            return None


class ThreadUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating a thread title."""

    class Meta:
        model = Thread
        fields = ["title"]


class ThreadCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating threads with initial post."""

    content = serializers.CharField(write_only=True)
    attachments = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=True,
    )
    poll_data = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Thread
        fields = ["id", "title", "slug", "content", "attachments", "poll_data"]
        read_only_fields = ["slug"]

    def validate_attachments(self, value: list) -> list:
        from .utils import validate_file_size

        for file in value:
            validate_file_size(file)
        return value

    def validate_poll_data(self, value: object) -> dict:
        if value is None:
            return value
        serializer = PollCreateSerializer(data=value)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def create(self, validated_data: dict) -> Thread:
        from django.utils import timezone

        from .utils import generate_docx_preview

        content = validated_data.pop("content")
        attachments = validated_data.pop("attachments", [])
        poll_data = validated_data.pop("poll_data", None)
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

        # Create poll if poll_data is provided
        if poll_data:
            poll = Poll.objects.create(
                post=post,
                question=poll_data["question"],
                allow_multiple_votes=poll_data.get("allow_multiple_votes", False),
                is_anonymous=poll_data.get("is_anonymous", False),
                created_by=post.author,
            )
            for i, option_data in enumerate(poll_data["options"]):
                PollOption.objects.create(poll=poll, text=option_data["text"], order=i)

        # Update subgroup's last activity timestamp
        thread.subgroup.last_activity_at = timezone.now()
        thread.subgroup.save(update_fields=["last_activity_at"])

        # Extract mentions first — mentioned users get a mention notification
        # (higher priority) instead of the generic new_thread notification.
        from apps.notifications.tasks import (
            notify_mentions_task,
            notify_new_thread_task,
            notify_subgroup_activity_new_thread_task,
        )
        from apps.notifications.utils import extract_mention_ids

        mention_ids = extract_mention_ids(content)

        # Only exclude mentioned users who will actually receive MENTION.
        # Users with notify_mentions=False won't get MENTION, so they should fall back
        # to lower-priority notifications (new_thread, subgroup_activity).
        if mention_ids:
            mentioned_who_opt_out = set(
                User.objects.filter(
                    id__in=mention_ids,
                    notification_preferences__notify_mentions=False,
                ).values_list("id", flat=True)
            )
            effective_mention_ids = [mid for mid in mention_ids if mid not in mentioned_who_opt_out]
        else:
            effective_mention_ids = []

        notify_new_thread_task(
            author_id=thread.author.id,
            thread_title=thread.title,
            thread_id=thread.id,
            subgroup_name=thread.subgroup.name,
            subgroup_slug=thread.subgroup.slug,
            subgroup_id=thread.subgroup.id,
            thread_slug=thread.slug,
            initial_post_content=content,
            exclude_user_ids=effective_mention_ids if effective_mention_ids else None,
        )

        # Notify subgroup subscribers with subgroup_activity but not forum_subscriptions.
        # These users won't receive NEW_THREAD but still want to know about new threads.
        notify_subgroup_activity_new_thread_task(
            author_id=thread.author.id,
            thread_title=thread.title,
            thread_id=thread.id,
            subgroup_id=thread.subgroup.id,
            subgroup_name=thread.subgroup.name,
            subgroup_slug=thread.subgroup.slug,
            thread_slug=thread.slug,
            initial_post_content=content,
            post_id=post.id,
            exclude_user_ids=[thread.author.id] + list(effective_mention_ids),
        )

        if mention_ids:
            notify_mentions_task(
                author_id=post.author.id,
                mentioned_user_ids=mention_ids,
                context_label=f"indlæg i '{thread.title}'",
                link=f"/forum/{thread.subgroup.slug}/traad/{thread.slug}#post-{post.id}",
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
            "slug",
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
        fields = ["name", "slug", "parent"]
        read_only_fields = ["slug"]

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

    def validate_file(self, value):
        from .utils import validate_file_size

        validate_file_size(value)
        return value

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
    thread_slug = serializers.CharField(source="thread.slug", read_only=True)
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
            "thread_slug",
            "subgroup_slug",
            "subgroup_name",
            "created_at",
        ]
