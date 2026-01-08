"""
URL configuration for KB Intra project.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
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

# Serve media files (for small-scale deployment, Django serving is fine)
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
