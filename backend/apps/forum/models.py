"""
Forum models for KB Intra community platform.
"""

from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Subgroup(models.Model):
    """
    A forum subgroup/category.
    Users can subscribe to subgroups to receive notifications.
    """

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    links_info = models.TextField(
        blank=True,
        default="",
        help_text="Rich text content for the 'Links og info' tab.",
    )
    slug = models.SlugField(max_length=100, unique=True, blank=True)
    is_default = models.BooleanField(
        default=False,
        help_text="If true, new users are automatically subscribed to this subgroup.",
    )
    is_committee = models.BooleanField(
        default=False,
        help_text="If true, this subgroup is a committee (Udvalg).",
    )
    allows_members = models.BooleanField(
        default=False,
        help_text="If true, this subgroup has formal members and can host members-only threads/files.",
    )
    default_members_only = models.BooleanField(
        default=False,
        help_text="If true, the 'Privat tråd' checkbox is checked by default when creating threads/files.",
    )
    is_main = models.BooleanField(
        default=False,
        help_text="If true, this subgroup appears at the very top (e.g., Fælles).",
    )
    icon = models.CharField(
        max_length=30,
        blank=True,
        default="",
        help_text="Tabler icon name for display, e.g. 'users', 'home'. Empty = default per type.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Updated when a thread or post is created in this subgroup.",
    )

    class Meta:
        ordering = ["-is_main", "-is_committee", "-last_activity_at"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate slug from name if not provided."""
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class SubgroupSubscription(models.Model):
    """
    User subscription to a forum subgroup.
    Controls notification preferences per subgroup.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subgroup_subscriptions",
    )
    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="subscriptions",
    )
    notify_new_threads = models.BooleanField(default=True)
    notify_replies = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "subgroup"], name="unique_user_subgroup"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user} -> {self.subgroup}"


class Thread(models.Model):
    """
    A forum thread/topic within a subgroup.
    """

    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="threads",
    )
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, allow_unicode=True, blank=True, db_index=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="threads",
    )
    is_pinned = models.BooleanField(default=False)
    is_closed = models.BooleanField(
        default=False,
        help_text="If true, no new posts can be added to this thread.",
    )
    members_only = models.BooleanField(
        default=False,
        help_text="If true, only members of the subgroup (and the author) can see this thread.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_pinned", "-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["subgroup", "slug"], name="unique_thread_subgroup_slug"
            ),
        ]

    def __str__(self) -> str:
        return self.title

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.slug:
            self.slug = self._generate_slug()
        super().save(*args, **kwargs)

    def _generate_slug(self) -> str:
        base = slugify(self.title, allow_unicode=True) or "traad"
        slug = base
        n = 2
        while Thread.objects.filter(subgroup=self.subgroup, slug=slug).exists():
            slug = f"{base}-{n}"
            n += 1
        return slug


class Post(models.Model):
    """
    A post/reply within a forum thread.
    """

    thread = models.ForeignKey(
        Thread,
        on_delete=models.CASCADE,
        related_name="posts",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="posts",
    )
    content = models.TextField(blank=True, default="")
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="edited_posts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Post by {self.author} in {self.thread}"


class PostAttachment(models.Model):
    """
    A file attachment for a forum post.
    """

    post = models.ForeignKey(
        Post,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="post_attachments",
    )
    file = models.FileField(upload_to="post_attachments/")
    name = models.CharField(max_length=255)
    preview_html = models.TextField(
        blank=True,
        help_text="HTML preview for DOCX files, generated on upload.",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self) -> str:
        return f"{self.name} on {self.post}"

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file from storage when the attachment is deleted."""
        self.file.delete(save=False)
        return super().delete(*args, **kwargs)


class Folder(models.Model):
    """
    A folder for organizing files within a subgroup.
    """

    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="folders",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100, allow_unicode=True, blank=True, db_index=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["subgroup", "parent", "name"], name="unique_folder_subgroup_parent_name"
            ),
            models.UniqueConstraint(
                fields=["subgroup", "slug"], name="unique_folder_subgroup_slug"
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.slug:
            self.slug = self._generate_slug()
        super().save(*args, **kwargs)

    def _generate_slug(self) -> str:
        base = slugify(self.name, allow_unicode=True) or "mappe"
        slug = base
        n = 2
        while Folder.objects.filter(subgroup=self.subgroup, slug=slug).exists():
            slug = f"{base}-{n}"
            n += 1
        return slug


class Reaction(models.Model):
    """
    A reaction (emoji) on a forum post.
    """

    REACTION_CHOICES = [
        ("like", "👍"),
        ("heart", "❤️"),
        ("laugh", "😂"),
        ("surprised", "😮"),
        ("sad", "😢"),
        ("celebrate", "🎉"),
        ("claim", "🙋"),
    ]

    post = models.ForeignKey(
        Post,
        on_delete=models.CASCADE,
        related_name="reactions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="post_reactions",
    )
    reaction_type = models.CharField(max_length=20, choices=REACTION_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["post", "user", "reaction_type"], name="unique_reaction_per_user"
            ),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.user} reacted {self.reaction_type} to {self.post}"


class Poll(models.Model):
    """
    A poll attached to a forum post. Supports single/multiple choice and anonymous voting.
    """

    post = models.OneToOneField(
        Post,
        on_delete=models.CASCADE,
        related_name="poll",
    )
    question = models.CharField(max_length=300)
    allow_multiple_votes = models.BooleanField(default=False)
    is_anonymous = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="polls",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.question


class PollOption(models.Model):
    """
    An option within a poll.
    """

    poll = models.ForeignKey(
        Poll,
        on_delete=models.CASCADE,
        related_name="options",
    )
    text = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.text


class PollVote(models.Model):
    """
    A user's vote on a poll option.
    """

    option = models.ForeignKey(
        PollOption,
        on_delete=models.CASCADE,
        related_name="votes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="poll_votes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["option", "user"], name="unique_poll_vote_per_user"),
        ]

    def __str__(self) -> str:
        return f"{self.user} voted for {self.option}"


class ThreadReadStatus(models.Model):
    """Tracks when a user last read a thread, for unread tracking."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="thread_read_statuses",
    )
    thread = models.ForeignKey(
        Thread,
        on_delete=models.CASCADE,
        related_name="read_statuses",
    )
    last_read_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "thread"], name="unique_thread_read_status"),
        ]

    def __str__(self) -> str:
        return f"{self.user} read {self.thread} at {self.last_read_at}"


class ThreadMuteStatus(models.Model):
    """Tracks when a user has muted notifications for a specific thread."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="thread_mutes",
    )
    thread = models.ForeignKey(
        Thread,
        on_delete=models.CASCADE,
        related_name="mute_statuses",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "thread"], name="unique_thread_mute_status"),
        ]

    def __str__(self) -> str:
        return f"{self.user} muted {self.thread}"


class File(models.Model):
    """
    A file uploaded to a subgroup, either in a folder or at root level.
    """

    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="files",
        null=True,
        blank=True,
    )
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name="files",
        null=True,
        blank=True,
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_files",
    )
    file = models.FileField(upload_to="forum_files/")
    name = models.CharField(max_length=255)
    preview_html = models.TextField(
        blank=True,
        help_text="HTML preview for DOCX files, generated on upload.",
    )
    members_only = models.BooleanField(
        default=False,
        help_text="If true, only members of the subgroup (and the uploader) can see this file.",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self) -> str:
        return self.name

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file from storage when the model instance is deleted."""
        self.file.delete(save=False)
        return super().delete(*args, **kwargs)


class SubgroupMembership(models.Model):
    """
    Membership of a user in a forum subgroup.

    Distinct from SubgroupSubscription: subscription = notification preference,
    membership = formal participation. Membership implies subscription (auto-created).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subgroup_memberships",
    )
    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    role = models.CharField(
        max_length=100,
        default="Medlem",
        blank=True,
        help_text="Free-text role label, e.g., 'Medlem', 'Leder', 'Kasserer'.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "subgroup"], name="unique_user_subgroup_membership"
            ),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.user} member of {self.subgroup}"
