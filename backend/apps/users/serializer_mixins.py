"""Shared serializer helpers for User/House/Child profile pictures."""

from __future__ import annotations

from typing import Any


class AvatarUrlMixin:
    """Replace `profile_picture` in serialized output with the model's
    `avatar_url` property, which prefers the small thumbnail over the
    full-resolution original.

    Apply as a mixin to any ModelSerializer whose model exposes
    `avatar_url` (User, House, Child) AND lists `profile_picture` in
    `Meta.fields`. Safe for read-write serializers: input still goes
    through the underlying ImageField; only the output URL is swapped.
    """

    def to_representation(self, instance: Any) -> dict[str, Any]:
        data = super().to_representation(instance)  # type: ignore[misc]
        if "profile_picture" in data and hasattr(instance, "avatar_url"):
            data["profile_picture"] = instance.avatar_url
        return data
