"""
Forum models for KB Intra community platform.
"""

import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.text import slugify

from apps.messaging.encryption import EncryptedTextField

from .utils import danish_slugify


class SubgroupQuerySet(models.QuerySet):
    def visible_to(self, user: object) -> "SubgroupQuerySet":
        """The groups `user` may know exist: every group but the secret ones they
        aren't a member of. Staff get no bypass, as with private threads."""
        if not getattr(user, "is_authenticated", False):
            return self.filter(is_secret=False)
        mine = SubgroupMembership.objects.filter(user=user).values("subgroup_id")
        return self.filter(Q(is_secret=False) | Q(id__in=mine))


class Subgroup(models.Model):
    """
    A forum subgroup/category.
    Users can subscribe to subgroups to receive notifications.
    """

    objects = models.Manager.from_queryset(SubgroupQuerySet)()

    class Reporting(models.TextChoices):
        """Whether this group takes indrapporteringer, and who may read them.

        One field rather than an on/off flag beside a private/public flag: two
        booleans can express "closed but switched off", a state with no meaning
        that every read site would then have to think about.
        """

        OFF = "off", "Ingen indrapportering"
        OPEN = "open", "Åben — alle kan læse sagerne"
        CLOSED = "closed", "Lukket — kun udvalget og indrapportøren kan læse sagerne"

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
    is_secret = models.BooleanField(
        default=False,
        help_text=(
            "Only members know the group exists: it is left out of every list, search and "
            "picker for everybody else, and its threads and files are always members-only. "
            "Chosen when the group is created and fixed after that — turning it on later "
            "would hide what non-members already wrote, turning it off would publish what "
            "was written in confidence. Members add each other; there is no staff bypass."
        ),
    )
    reporting = models.CharField(
        max_length=10,
        choices=Reporting.choices,
        default=Reporting.OFF,
        help_text=(
            "Whether residents can file reports (indrapporteringer) to this group, and who "
            "may read the queue. The group's members are the caseworkers either way, so "
            "anything but 'off' requires allows_members."
        ),
    )
    reporting_intro = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text=(
            "One line under the udvalg's name in the 'Til:' picker, saying what belongs "
            "here — e.g. 'Fejlmelding af inventar'. Keep it to one line on a phone."
        ),
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
        # Deliberately NOT ordered by last_activity_at: that timestamp is bumped
        # by private/members-only threads too, which would float a subgroup to
        # the top for people who can't see the activity. Activity ordering is
        # done per-viewer in the serializer/frontend via latest_thread_activity_at.
        #
        # `name` is the tiebreaker because those two flags leave 40 of the 50
        # groups equal, and without it SQLite returns them in whatever order the
        # rows happen to sit in — so a list could reshuffle after any edit.
        ordering = ["-is_main", "-is_committee", "name"]

    def __str__(self) -> str:
        return self.name

    def clean(self) -> None:
        """A group taking reports must be one that has members.

        Its members are the caseworkers: without them a case arrives where
        nobody can move it, and a closed queue would be one nobody can even
        read. Admin runs model validation on the change form and on the
        editable list, which is everywhere this gets flipped.
        """
        super().clean()
        if self.reporting != self.Reporting.OFF and not self.allows_members:
            raise ValidationError(
                {
                    "reporting": (
                        "Indrapportering kræver, at gruppen har medlemmer "
                        "(«Tillader medlemmer»), for det er dem der behandler sagerne."
                    )
                }
            )
        # A secret group's members are the only ones who may see it, so it can't
        # appear where everybody looks: the 'Til:' picker or a new resident's list.
        if self.is_secret and self.reporting != self.Reporting.OFF:
            raise ValidationError({"reporting": "En hemmelig gruppe kan ikke tage imod sager."})
        if self.is_secret and self.is_default:
            raise ValidationError(
                {"is_default": "En hemmelig gruppe kan ikke følges automatisk af alle."}
            )

    @property
    def reporting_is_closed(self) -> bool:
        """Whether only the udvalg (and each reporter) may read its queue."""
        return self.reporting == self.Reporting.CLOSED

    def save(self, *args: object, **kwargs: object) -> None:
        """Generate slug from name if not provided."""
        if self.is_secret:
            self.allows_members = True  # its members are the only way in
        if not self.slug:
            self.slug = self._generate_slug()
        super().save(*args, **kwargs)

    def _generate_slug(self) -> str:
        """The name as a slug, numbered if taken.

        A secret group's slug also gets a random tail. Otherwise a resident
        creating "Bandet" would get "bandet-2" — or before that a crash — and
        learn that a group of that name is hidden from them. With the tail the
        two never compete for a slug, and the address can't be guessed either.
        """
        base = (danish_slugify(self.name) or "gruppe")[:90]
        if self.is_secret:
            base = f"{base}-{secrets.token_hex(3)}"
        slug = base
        n = 2
        while Subgroup.objects.filter(slug=slug).exists():
            slug = f"{base}-{n}"
            n += 1
        return slug


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


def _keep_secret(obj: "Thread | File", save_kwargs: dict) -> None:
    """Everything in a secret group is for its members only.

    Enforced here rather than in each view so a thread or file can't land in a
    secret group by any road — created, moved in, made by an event, edited in
    admin — and be public. The notifications and @mention filters key on
    members_only, so this is what keeps them from reaching outsiders.
    """
    if obj.members_only or obj.subgroup_id is None or not obj.subgroup.is_secret:
        return
    obj.members_only = True
    update_fields = save_kwargs.get("update_fields")
    if update_fields is not None:
        save_kwargs["update_fields"] = {*update_fields, "members_only"}


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
    client_token = models.UUIDField(
        null=True,
        blank=True,
        unique=True,
        help_text="One per compose form. A retry with the same token gets this thread back.",
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
        _keep_secret(self, kwargs)
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
    client_token = models.UUIDField(
        null=True,
        blank=True,
        unique=True,
        help_text="One per reply form. A retry with the same token gets this post back.",
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
    A poll in a forum post or in a chat message — exactly one of the two. Supports
    single/multiple choice and anonymous voting.

    The question and the options are encrypted at rest like message content, so a
    poll in a private chat is as private as the messages around it. Lengths are
    checked by the serializers (300/200 characters); the columns hold ciphertext.
    """

    post = models.OneToOneField(
        Post,
        on_delete=models.CASCADE,
        related_name="poll",
        null=True,
        blank=True,
    )
    message = models.OneToOneField(
        "messaging.Message",
        on_delete=models.CASCADE,
        related_name="poll",
        null=True,
        blank=True,
    )
    question = EncryptedTextField()
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

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(post__isnull=False, message__isnull=True)
                    | models.Q(post__isnull=True, message__isnull=False)
                ),
                name="poll_in_post_or_message",
            ),
        ]

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
    text = EncryptedTextField()
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

    def save(self, *args: object, **kwargs: object) -> None:
        _keep_secret(self, kwargs)
        super().save(*args, **kwargs)

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
