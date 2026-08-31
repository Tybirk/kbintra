"""
Forum models for KB Intra community platform.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify

from .utils import danish_slugify

MAX_PARENT_DEPTH = 10


def validate_subgroup_parent(instance: "Subgroup", parent: "Subgroup | None") -> None:
    """Validate a candidate parent for a Subgroup against the hierarchy rules.

    Shared by Subgroup.clean() (so Django admin's ModelForm.full_clean() is
    protected) and the serializer layer (so the API returns a clean 400
    instead of a 500). Raises django.core.exceptions.ValidationError.

    Rules:
    - almindelig: parent must be None.
    - organ types (generalforsamling/faellesmoede/bestyrelse/udvalg): parent must be None.
    - arbejdsgruppe: parent must be an organ or another arbejdsgruppe (never almindelig,
      never itself/a descendant); parent may also be None.
    - No cycles: a group may not be its own ancestor (depth-capped ancestor walk).
    """
    if parent is None:
        return

    if instance.group_type == Subgroup.GroupType.ALMINDELIG:
        raise ValidationError("En almindelig gruppe kan ikke have en forælder.")

    if instance.group_type in Subgroup.ORGAN_TYPES:
        raise ValidationError("Et organ kan ikke have en forælder.")

    allowed_parent_types = Subgroup.ORGAN_TYPES | {Subgroup.GroupType.ARBEJDSGRUPPE}
    if (
        instance.group_type == Subgroup.GroupType.ARBEJDSGRUPPE
        and parent.group_type not in allowed_parent_types
    ):
        raise ValidationError(
            "En arbejdsgruppes forælder skal være et organ eller en anden arbejdsgruppe."
        )

    # Cycle check: walk up from the candidate parent, looking for `instance`.
    current_id: int | None = parent.pk
    depth = 0
    while current_id is not None:
        if instance.pk is not None and current_id == instance.pk:
            raise ValidationError("En gruppe kan ikke være sin egen forfader.")
        depth += 1
        if depth > MAX_PARENT_DEPTH:
            raise ValidationError("Hierarkiet er for dybt (muligvis en cyklus).")
        current_id = (
            Subgroup.objects.filter(pk=current_id).values_list("parent_id", flat=True).first()
        )


class Subgroup(models.Model):
    """
    A forum subgroup/category.
    Users can subscribe to subgroups to receive notifications.
    """

    class GroupType(models.TextChoices):
        GENERALFORSAMLING = "generalforsamling", "Generalforsamling"
        FAELLESMOEDE = "faellesmoede", "Fællesmøde"
        BESTYRELSE = "bestyrelse", "Bestyrelse"
        UDVALG = "udvalg", "Udvalg"
        ARBEJDSGRUPPE = "arbejdsgruppe", "Arbejdsgruppe"
        ALMINDELIG = "almindelig", "Almindelig gruppe"

    ORGAN_TYPES = {
        GroupType.GENERALFORSAMLING,
        GroupType.FAELLESMOEDE,
        GroupType.BESTYRELSE,
        GroupType.UDVALG,
    }

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    links_info = models.TextField(
        blank=True,
        default="",
        help_text="Rich text content for the 'Links og info' tab.",
    )
    links_info_members = models.TextField(
        blank=True,
        default="",
        help_text="Members-only rich text content shown below 'Links og info'.",
    )
    slug = models.SlugField(max_length=100, unique=True, blank=True)
    is_default = models.BooleanField(
        default=False,
        help_text="If true, new users are automatically subscribed to this subgroup.",
    )
    group_type = models.CharField(
        max_length=20,
        choices=GroupType.choices,
        default=GroupType.ALMINDELIG,
        db_index=True,
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
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
        help_text="Soft navigation/structure link only — not a permission or visibility cascade.",
    )
    established_on = models.DateField(
        null=True,
        blank=True,
        help_text="Official creation date, distinct from the system created_at timestamp.",
    )
    expires_on = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="False = afsluttet/arkiveret. Hidden from the forum list by default.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Updated when a thread or post is created in this subgroup.",
    )

    class Meta:
        # Deliberately NOT ordered by last_activity_at: that timestamp is bumped
        # by private/members-only threads too, which would float a subgroup to
        # the top for people who can't see the activity. Activity ordering is
        # done per-viewer in the serializer/frontend via latest_thread_activity_at.
        #
        # `name` is the tiebreaker because is_main leaves nearly every group
        # equal, and without it SQLite returns them in whatever order the rows
        # happen to sit in — so a list could reshuffle after any edit. Organ
        # grouping (generalforsamling → bestyrelse → udvalg) is a display
        # concern handled per-view, not a stable database ordering.
        ordering = ["-is_main", "name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate slug from name if not provided."""
        if not self.slug:
            self.slug = danish_slugify(self.name)
        super().save(*args, **kwargs)

    def clean(self) -> None:
        super().clean()
        validate_subgroup_parent(self, self.parent)

    @property
    def is_organ(self) -> bool:
        return self.group_type in self.ORGAN_TYPES

    @property
    def is_working_group(self) -> bool:
        return self.group_type == self.GroupType.ARBEJDSGRUPPE


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
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
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
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            # Speeds up RecentActivityView, which orders posts by -created_at
            # filtered to visible thread ids.
            models.Index(fields=["thread", "-created_at"], name="forum_post_thread_recent_idx"),
        ]

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
    thumbnail = models.ImageField(
        upload_to="post_attachments/thumbs/",
        blank=True,
        null=True,
        help_text="400px-longest-edge JPEG thumbnail for gallery/inline display.",
    )
    preview = models.ImageField(
        upload_to="post_attachments/previews/",
        blank=True,
        null=True,
        help_text="Full-size web-viewable JPEG for formats browsers can't render (e.g. HEIC).",
    )
    name = models.CharField(max_length=255)
    preview_html = models.TextField(
        blank=True,
        help_text="HTML preview for DOCX files, generated on upload.",
    )
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self) -> str:
        return f"{self.name} on {self.post}"

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file(s) from storage when the attachment is deleted."""
        self.file.delete(save=False)
        if self.thumbnail:
            self.thumbnail.delete(save=False)
        if self.preview:
            self.preview.delete(save=False)
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
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
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
    reaction_type = models.CharField(max_length=50)
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
    allow_others_to_add_options = models.BooleanField(default=False)
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
    legacy_url = models.CharField(max_length=500, blank=True, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self) -> str:
        return self.name

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file from storage when the model instance is deleted."""
        self.file.delete(save=False)
        return super().delete(*args, **kwargs)


class SubgroupRoleOption(models.Model):
    """
    Curated list of role labels suggested when assigning roles to subgroup members.

    Admin-editable. The SubgroupMembership.role field remains free-text, so custom
    roles are still allowed — these are just the standard suggestions shown in the UI.
    """

    name = models.CharField(max_length=100, unique=True)
    order = models.IntegerField(
        default=0, help_text="Lower numbers appear first in the role picker."
    )

    class Meta:
        ordering = ["order", "name"]

    def __str__(self) -> str:
        return self.name


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
