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
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.backup.views import serve_media


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

        auth.login(request, serializer.user, backend="django.contrib.auth.backends.ModelBackend")

        return Response(serializer.validated_data, status=status.HTTP_200_OK)


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
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
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
]

# Serve media files with S3 fallback (restores missing files from backup)
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", serve_media),
]
