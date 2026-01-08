"""
URL configuration for KB Intra project.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
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
    path("api/calendar/", include("apps.calendar_app.urls")),
    path("api/messages/", include("apps.messaging.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
]

# Serve media files (static() helper doesn't work when DEBUG=False, so use re_path directly)
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
