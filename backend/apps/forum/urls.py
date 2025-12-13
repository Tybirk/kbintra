"""
URL configuration for forum endpoints.
"""

from django.urls import path

from .views import (
    FileDeleteView,
    FileListCreateView,
    FileMoveView,
    FolderDetailView,
    FolderListCreateView,
    MySubscriptionsView,
    PostListCreateView,
    PostUpdateDeleteView,
    SubgroupDetailView,
    SubgroupFileListCreateView,
    SubgroupListView,
    SubscribeView,
    ThreadDeleteView,
    ThreadDetailView,
    ThreadListCreateView,
    UnsubscribeView,
)

urlpatterns = [
    # Subgroups
    path("subgroups/", SubgroupListView.as_view(), name="subgroup-list"),
    path("subgroups/<slug:slug>/", SubgroupDetailView.as_view(), name="subgroup-detail"),
    path("subgroups/<slug:slug>/subscribe/", SubscribeView.as_view(), name="subscribe"),
    path("subgroups/<slug:slug>/unsubscribe/", UnsubscribeView.as_view(), name="unsubscribe"),
    path("subscriptions/", MySubscriptionsView.as_view(), name="my-subscriptions"),
    # Threads
    path("subgroups/<slug:slug>/threads/", ThreadListCreateView.as_view(), name="thread-list"),
    path("threads/<int:pk>/", ThreadDetailView.as_view(), name="thread-detail"),
    path("threads/<int:pk>/delete/", ThreadDeleteView.as_view(), name="thread-delete"),
    # Posts
    path("threads/<int:thread_id>/posts/", PostListCreateView.as_view(), name="post-list"),
    path("posts/<int:pk>/", PostUpdateDeleteView.as_view(), name="post-detail"),
    # Folders
    path("subgroups/<slug:slug>/folders/", FolderListCreateView.as_view(), name="folder-list"),
    path("folders/<int:pk>/", FolderDetailView.as_view(), name="folder-detail"),
    # Files
    path("subgroups/<slug:slug>/files/", SubgroupFileListCreateView.as_view(), name="subgroup-file-list"),
    path("folders/<int:folder_id>/files/", FileListCreateView.as_view(), name="file-list"),
    path("files/<int:pk>/", FileDeleteView.as_view(), name="file-delete"),
    path("files/<int:pk>/move/", FileMoveView.as_view(), name="file-move"),
]
