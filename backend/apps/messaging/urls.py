"""
URL configuration for messaging endpoints.
"""

from django.urls import path

from .views import (
    AddParticipantsView,
    ConversationDetailView,
    ConversationListCreateView,
    MarkMessagesReadView,
    MessageListCreateView,
    UnreadCountView,
)

urlpatterns = [
    path("conversations/", ConversationListCreateView.as_view(), name="conversation-list"),
    path("conversations/<int:pk>/", ConversationDetailView.as_view(), name="conversation-detail"),
    path(
        "conversations/<int:pk>/add-participants/",
        AddParticipantsView.as_view(),
        name="add-participants",
    ),
    path(
        "conversations/<int:conversation_id>/messages/",
        MessageListCreateView.as_view(),
        name="message-list",
    ),
    path(
        "conversations/<int:conversation_id>/read/",
        MarkMessagesReadView.as_view(),
        name="mark-read",
    ),
    path("unread-count/", UnreadCountView.as_view(), name="unread-count"),
]
