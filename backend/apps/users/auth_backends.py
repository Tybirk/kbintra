"""
Authentication backends for KB Intra.
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.backends import ModelBackend
from django.http import HttpRequest

from apps.users.models import User


class CaseInsensitiveEmailBackend(ModelBackend):
    """Authenticate on email ignoring case and surrounding whitespace.

    Email addresses are case-insensitive in practice, and phone keyboards
    routinely capitalise the first letter of one. The stock `ModelBackend`
    looks the user up with an exact match, so `Anna@example.com` could not log
    in while the forgot-password flow (`email__iexact`) kept working: the reset
    mail arrived, the new password was set, and login still answered "wrong
    e-mail or password" — with nothing to tell the member which of the two was
    supposedly wrong.
    """

    def authenticate(
        self,
        request: HttpRequest | None,
        username: str | None = None,
        password: str | None = None,
        **kwargs: Any,
    ) -> User | None:
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if username is None or password is None:
            return None

        email = username.strip()
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            # Hash once anyway so an unknown address takes the same time as a
            # wrong password, keeping the two indistinguishable to a caller.
            User().set_password(password)
            return None
        except User.MultipleObjectsReturned:
            # Rows differing only by case predate this backend. Prefer the
            # exact match, so those members keep the behaviour they had.
            exact = User.objects.filter(email=email).first()
            if exact is None:
                return None
            user = exact

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
