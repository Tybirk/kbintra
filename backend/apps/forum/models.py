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
    slug = models.SlugField(max_length=100, unique=True, blank=True)
    is_default = models.BooleanField(
        default=False,
        help_text="If true, new users are automatically subscribed to this subgroup.",
    )
    is_committee = models.BooleanField(
        default=False,
        help_text="If true, this subgroup is a committee (Udvalg) and appears at the top.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Updated when a thread or post is created in this subgroup.",
    )

    class Meta:
        ordering = ["-is_committee", "-last_activity_at"]

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
        unique_together = ["user", "subgroup"]
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
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="threads",
    )
    is_pinned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_pinned", "-updated_at"]

    def __str__(self) -> str:
        return self.title


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
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"Post by {self.author} in {self.thread}"


class Folder(models.Model):
    """
    A folder for organizing files within a subgroup.
    """

    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="folders",
    )
    name = models.CharField(max_length=100)
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
        unique_together = ["subgroup", "parent", "name"]

    def __str__(self) -> str:
        return self.name


class File(models.Model):
    """
    A file uploaded to a subgroup, either in a folder or at root level.
    """

    subgroup = models.ForeignKey(
        Subgroup,
        on_delete=models.CASCADE,
        related_name="files",
    )
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name="files",
        null=True,
        blank=True,
        help_text="If null, file is at root level of the subgroup.",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="uploaded_files",
    )
    file = models.FileField(upload_to="forum_files/")
    name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self) -> str:
        return self.name
