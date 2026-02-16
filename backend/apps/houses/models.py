"""
House models for KB Intra community platform.
"""

from django.db import models


class House(models.Model):
    """
    Represents a house in the community.
    Inhabitants are linked via the User model's house foreign key.
    """

    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    profile_picture = models.ImageField(
        upload_to="house_pictures/",
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "children"

    def __str__(self) -> str:
        return f"{self.name} ({self.house.name})"


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
    license_plate = models.CharField(max_length=15)
    is_electric = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["license_plate"]

    def __str__(self) -> str:
        return f"{self.license_plate} ({self.house.name})"
