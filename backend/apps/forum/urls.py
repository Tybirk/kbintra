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
    PollDeleteView,
    PollVoteView,
    PostListCreateView,
    PostUpdateDeleteView,
    ReactionToggleView,
    ReactionTypesView,
    RecentActivityView,
    SubgroupDetailView,
    SubgroupFileListCreateView,
    SubgroupListView,
    SubscribeView,
    ThreadCloseView,
    ThreadDeleteView,
    ThreadDetailView,
    ThreadListCreateView,
    UnsubscribeView,
)

urlpatterns = [
    # Recent activity
    path("recent/", RecentActivityView.as_view(), name="recent-activity"),
    # Subgroups
    path("subgroups/", SubgroupListView.as_view(), name="subgroup-list"),
    path("subgroups/<slug:slug>/", SubgroupDetailView.as_view(), name="subgroup-detail"),
    path("subgroups/<slug:slug>/subscribe/", SubscribeView.as_view(), name="subscribe"),
    path("subgroups/<slug:slug>/unsubscribe/", UnsubscribeView.as_view(), name="unsubscribe"),
    path("subscriptions/", MySubscriptionsView.as_view(), name="my-subscriptions"),
    # Threads
    path("subgroups/<slug:slug>/threads/", ThreadListCreateView.as_view(), name="thread-list"),
    path("threads/<int:pk>/", ThreadDetailView.as_view(), name="thread-detail"),
    path("threads/<int:pk>/close/", ThreadCloseView.as_view(), name="thread-close"),
    path("threads/<int:pk>/delete/", ThreadDeleteView.as_view(), name="thread-delete"),
    # Posts
    path("threads/<int:thread_id>/posts/", PostListCreateView.as_view(), name="post-list"),
    path("posts/<int:pk>/", PostUpdateDeleteView.as_view(), name="post-detail"),
    # Reactions
    path("posts/<int:post_id>/react/", ReactionToggleView.as_view(), name="reaction-toggle"),
    path("reactions/types/", ReactionTypesView.as_view(), name="reaction-types"),
    # Folders
    path("subgroups/<slug:slug>/folders/", FolderListCreateView.as_view(), name="folder-list"),
    path("folders/<int:pk>/", FolderDetailView.as_view(), name="folder-detail"),
    # Files
    path(
        "subgroups/<slug:slug>/files/",
        SubgroupFileListCreateView.as_view(),
        name="subgroup-file-list",
    ),
    path("folders/<int:folder_id>/files/", FileListCreateView.as_view(), name="file-list"),
    path("files/<int:pk>/", FileDeleteView.as_view(), name="file-delete"),
    path("files/<int:pk>/move/", FileMoveView.as_view(), name="file-move"),
    # Polls
    path("polls/<int:poll_id>/vote/", PollVoteView.as_view(), name="poll-vote"),
    path("polls/<int:poll_id>/", PollDeleteView.as_view(), name="poll-delete"),
]
