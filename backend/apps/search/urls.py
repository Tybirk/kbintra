"""
URL configuration for search app.
"""

from django.urls import path

from .views import AdvancedSearchView, GlobalSearchView

urlpatterns = [
    path("", GlobalSearchView.as_view(), name="global-search"),
    path("advanced/", AdvancedSearchView.as_view(), name="advanced-search"),
]
