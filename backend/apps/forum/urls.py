"""
URL configuration for forum endpoints.
"""

from django.urls import path

from .views import (
    FileDetailView,
    FileListCreateView,
    FileMoveView,
    FolderBySlugView,
    FolderDeletePreviewView,
    FolderDetailView,
    FolderDownloadView,
    FolderListCreateView,
    ForumUnreadCountView,
    MarkAllForumReadView,
    MarkSubgroupReadView,
    MySubscriptionsView,
    OrganisationView,
    PollAddOptionView,
    PollDeleteView,
    PollVoteView,
    PostListCreateView,
    PostUpdateDeleteView,
    ReactionToggleView,
    ReactionTypesView,
    RecentActivityView,
    SubgroupDetailView,
    SubgroupFileListCreateView,
    SubgroupGalleryView,
    SubgroupLeaveView,
    SubgroupListView,
    SubgroupMemberDetailView,
    SubgroupMemberListCreateView,
    SubgroupRoleListView,
    SubgroupSubscribersListView,
    SubgroupUpdateView,
    SubscribeView,
    ThreadCloseView,
    ThreadDeleteView,
    ThreadDetailBySlugView,
    ThreadDetailView,
    ThreadListCreateView,
    ThreadMoveView,
    ThreadMuteToggleView,
    ThreadPinView,
    ThreadUpdateView,
    UnsubscribeView,
)

urlpatterns = [
    # Recent activity
    path("recent/", RecentActivityView.as_view(), name="recent-activity"),
    # Read status
    path("mark-all-read/", MarkAllForumReadView.as_view(), name="mark-all-read"),
    path("unread-count/", ForumUnreadCountView.as_view(), name="forum-unread-count"),
    # Organisation overview
    path("organisation/", OrganisationView.as_view(), name="organisation"),
    # Subgroups
    path("subgroups/", SubgroupListView.as_view(), name="subgroup-list"),
    path("subgroups/<slug:slug>/", SubgroupDetailView.as_view(), name="subgroup-detail"),
    path("subgroups/<slug:slug>/subscribe/", SubscribeView.as_view(), name="subscribe"),
    path("subgroups/<slug:slug>/unsubscribe/", UnsubscribeView.as_view(), name="unsubscribe"),
    path(
        "subgroups/<slug:slug>/subscribers/",
        SubgroupSubscribersListView.as_view(),
        name="subgroup-subscribers",
    ),
    path("subgroups/<slug:slug>/update/", SubgroupUpdateView.as_view(), name="subgroup-update"),
    # Membership
    path(
        "subgroups/<slug:slug>/members/",
        SubgroupMemberListCreateView.as_view(),
        name="subgroup-members",
    ),
    path(
        "subgroups/<slug:slug>/members/<int:user_id>/",
        SubgroupMemberDetailView.as_view(),
        name="subgroup-member-detail",
    ),
    path(
        "subgroups/<slug:slug>/leave/",
        SubgroupLeaveView.as_view(),
        name="subgroup-leave",
    ),
    path(
        "subgroups/<slug:slug>/mark-read/",
        MarkSubgroupReadView.as_view(),
        name="mark-subgroup-read",
    ),
    path("subscriptions/", MySubscriptionsView.as_view(), name="my-subscriptions"),
    # Gallery
    path(
        "subgroups/<slug:slug>/gallery/",
        SubgroupGalleryView.as_view(),
        name="subgroup-gallery",
    ),
    # Threads
    path("subgroups/<slug:slug>/threads/", ThreadListCreateView.as_view(), name="thread-list"),
    path(
        "subgroups/<slug:subgroup_slug>/threads/<str:thread_slug>/",
        ThreadDetailBySlugView.as_view(),
        name="thread-detail-by-slug",
    ),
    path("threads/<int:pk>/", ThreadDetailView.as_view(), name="thread-detail"),
    path("threads/<int:pk>/close/", ThreadCloseView.as_view(), name="thread-close"),
    path("threads/<int:pk>/pin/", ThreadPinView.as_view(), name="thread-pin"),
    path("threads/<int:pk>/delete/", ThreadDeleteView.as_view(), name="thread-delete"),
    path("threads/<int:pk>/move/", ThreadMoveView.as_view(), name="thread-move"),
    path("threads/<int:pk>/update/", ThreadUpdateView.as_view(), name="thread-update"),
    path("threads/<int:pk>/mute/", ThreadMuteToggleView.as_view(), name="thread-mute"),
    # Posts
    path("threads/<int:thread_id>/posts/", PostListCreateView.as_view(), name="post-list"),
    path("posts/<int:pk>/", PostUpdateDeleteView.as_view(), name="post-detail"),
    # Reactions
    path("posts/<int:post_id>/react/", ReactionToggleView.as_view(), name="reaction-toggle"),
    path("reactions/types/", ReactionTypesView.as_view(), name="reaction-types"),
    # Role options
    path("roles/", SubgroupRoleListView.as_view(), name="subgroup-role-list"),
    # Folders
    path("subgroups/<slug:slug>/folders/", FolderListCreateView.as_view(), name="folder-list"),
    path("folders/<int:pk>/", FolderDetailView.as_view(), name="folder-detail"),
    path(
        "folders/<int:pk>/delete-preview/",
        FolderDeletePreviewView.as_view(),
        name="folder-delete-preview",
    ),
    path("folders/<int:pk>/download/", FolderDownloadView.as_view(), name="folder-download"),
    path(
        "subgroups/<slug:slug>/folder/<str:folder_slug>/",
        FolderBySlugView.as_view(),
        name="folder-by-slug",
    ),
    # Files
    path(
        "subgroups/<slug:slug>/files/",
        SubgroupFileListCreateView.as_view(),
        name="subgroup-file-list",
    ),
    path("folders/<int:folder_id>/files/", FileListCreateView.as_view(), name="file-list"),
    path("files/<int:pk>/", FileDetailView.as_view(), name="file-detail"),
    path("files/<int:pk>/move/", FileMoveView.as_view(), name="file-move"),
    # Polls
    path("polls/<int:poll_id>/vote/", PollVoteView.as_view(), name="poll-vote"),
    path(
        "polls/<int:poll_id>/options/",
        PollAddOptionView.as_view(),
        name="poll-add-option",
    ),
    path("polls/<int:poll_id>/", PollDeleteView.as_view(), name="poll-delete"),
]
