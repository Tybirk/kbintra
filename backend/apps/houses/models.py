"""
House models for KB Intra community platform.
"""

from django.db import models
from django.utils.text import slugify


def derive_house_slug(name: str) -> str:
    """Derive a house slug from its name by extracting the trailing integer.

    "Kløverbakkevej 3" → "3". Falls back to slugify(name) if no trailing
    integer is present.
    """
    parts = name.split()
    if parts:
        try:
            return str(int(parts[-1]))
        except ValueError:
            pass
    return slugify(name)


class House(models.Model):
    """
    Represents a house in the community.
    Inhabitants are linked via the User model's house foreign key.
    """

    name = models.CharField(max_length=100)
    slug = models.CharField(max_length=20, unique=True, blank=True, db_index=True)
    description = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    profile_picture = models.ImageField(
        upload_to="house_pictures/",
        blank=True,
        null=True,
    )
    profile_picture_thumbnail = models.ImageField(
        upload_to="house_pictures/thumbs/",
        blank=True,
        null=True,
        help_text="400x400 JPEG square crop, generated server-side on upload.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.slug:
            self.slug = derive_house_slug(self.name)
        super().save(*args, **kwargs)

    @property
    def avatar_url(self) -> str | None:
        if self.profile_picture_thumbnail:
            return self.profile_picture_thumbnail.url
        if self.profile_picture:
            return self.profile_picture.url
        return None


class Child(models.Model):
    """
    Represents a child living in a house.
    Children are not regular users - they don't have login credentials.
    They are connected to a house for display in resident overview.
    """

    house = models.ForeignKey(
        House,
        on_delete=models.CASCADE,
        related_name="children",
    )
    name = models.CharField(max_length=100)
    birthdate = models.DateField(blank=True, null=True)
    profile_picture = models.ImageField(
        upload_to="child_pictures/",
        blank=True,
        null=True,
    )
    profile_picture_thumbnail = models.ImageField(
        upload_to="child_pictures/thumbs/",
        blank=True,
        null=True,
        help_text="400x400 JPEG square crop, generated server-side on upload.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "children"

    def __str__(self) -> str:
        return f"{self.name} ({self.house.name})"

    @property
    def avatar_url(self) -> str | None:
        if self.profile_picture_thumbnail:
            return self.profile_picture_thumbnail.url
        if self.profile_picture:
            return self.profile_picture.url
        return None


class Car(models.Model):
    """
    Represents a car registered to a house.
    Used to look up car owners by license plate number.
    """

    house = models.ForeignKey(
        House,
        on_delete=models.CASCADE,
        related_name="cars",
    )
    license_plate = models.CharField(max_length=15, blank=True, default="")
    is_electric = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["license_plate"]

    def save(self, *args, **kwargs):
        from .utils import normalize_license_plate

        self.license_plate = normalize_license_plate(self.license_plate)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.license_plate} ({self.house.name})"
