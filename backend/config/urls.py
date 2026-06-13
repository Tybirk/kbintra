"""
URL configuration for KB Intra project.
"""

from typing import Any

from django.contrib import admin, auth
from django.http import HttpRequest, JsonResponse
from django.urls import include, path, re_path
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.backup.views import serve_media

_AUTH_BACKEND = "django.contrib.auth.backends.ModelBackend"


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # Replicates the parent post(), but additionally calls auth.login() so
        # the response carries a sessionid cookie. The session gates same-origin
        # /media/* requests (gives <img src="/media/..."> credentials for free).
        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as e:
            raise InvalidToken(e.args[0]) from e

        auth.login(request, serializer.user, backend=_AUTH_BACKEND)

        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class TokenRefreshWithSessionView(TokenRefreshView):
    """`TokenRefreshView` that also (re)issues the Django session cookie.

    Why: JWT silent-refresh runs without going through `JWTSessionAuthentication`
    (the refresh token is in the body, not the Bearer header). Without this,
    returning users whose access token expired between visits would 401 on
    `/media/*` until their first authenticated API call backfills a session —
    causing a one-time flash of broken images on first page load.
    """

    def post(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        response = super().post(request, *args, **kwargs)
        if response.status_code != 200:
            return response

        # Decode the just-issued access token to find the user. The token is
        # signed and was produced by trusted code, so this is safe.
        try:
            access = AccessToken(response.data["access"])
            from apps.users.models import User  # avoid circular import at module load

            user = User.objects.get(pk=access["user_id"], is_active=True)
        except Exception:
            # Refresh succeeded — don't break the response if the session
            # bridge can't find the user (deleted, deactivated, etc.). JWT auth
            # still works; `JWTSessionAuthentication` will create the session
            # on the next API call.
            return response

        auth.login(request, user, backend=_AUTH_BACKEND)
        return response


def health_check(request: HttpRequest) -> JsonResponse:
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return JsonResponse({"status": "ok"})


urlpatterns = [
    # Health check (unauthenticated, used by Docker/Traefik)
    path("api/health/", health_check),
    # Admin
    path("admin/", admin.site.urls),
    # JWT Authentication
    path("api/auth/token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshWithSessionView.as_view(), name="token_refresh"),
    # App APIs
    path("api/auth/", include("apps.users.urls")),
    path("api/users/", include("apps.users.urls_users")),
    path("api/houses/", include("apps.houses.urls")),
    path("api/forum/", include("apps.forum.urls")),
    path("api/announcements/", include("apps.announcements.urls")),
    path("api/food/", include("apps.food.urls", namespace="food")),
    path("api/events/", include("apps.events.urls")),
    path("api/messages/", include("apps.messaging.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/search/", include("apps.search.urls")),
    path("api/bookings/", include("apps.bookings.urls")),
    path("api/links/", include("apps.links.urls")),
    path("api/expenses/", include("apps.expenses.urls")),
]

# Serve media files with S3 fallback (restores missing files from backup)
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", serve_media),
]
