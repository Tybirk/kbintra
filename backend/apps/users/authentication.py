"""
JWT authentication that also issues a Django session cookie.

The session cookie gates same-origin `/media/*` requests so `<img src="/media/...">`
tags carry credentials automatically. JWT remains the primary auth for the API;
the session is purely a side-effect to make file URLs authenticated.
"""

from django.contrib import auth
from rest_framework.request import Request
from rest_framework_simplejwt.authentication import JWTAuthentication


class JWTSessionAuthentication(JWTAuthentication):
    """JWT auth that ensures a Django session exists for the authenticated user.

    On a successful JWT auth, if the request has no session yet, log the user
    in via `django.contrib.auth.login` so SessionMiddleware sets a sessionid
    cookie on the response. Subsequent same-origin requests (including
    `<img>` fetches of `/media/...`) then carry the cookie automatically.
    """

    def authenticate(self, request: Request) -> tuple | None:
        result = super().authenticate(request)
        if result is None:
            return None

        user, _ = result
        if not request.session.session_key:
            auth.login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return result
