"""
URL configuration for KB Intra project.
"""

from django.conf import settings
from django.contrib import admin
from django.http import HttpRequest, JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


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
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
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

# Serve media files (static() helper doesn't work when DEBUG=False, so use re_path directly)
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
