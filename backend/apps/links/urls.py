from django.urls import path

from .views import UsefulLinksView

urlpatterns = [
    path("", UsefulLinksView.as_view(), name="useful-links"),
]
