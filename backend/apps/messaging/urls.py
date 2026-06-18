"""
URL configuration for messaging endpoints.
"""

from django.urls import path

from .views import (
    AddParticipantsView,
    ConversationDetailView,
    ConversationListCreateView,
    LeaveConversationView,
    MarkMessagesReadView,
    MarkMessagesUnreadView,
    MarkMessageUnreadView,
    MessageEditView,
    MessageListCreateView,
    MessageReactionToggleView,
    MessageUnsendView,
    RenameConversationView,
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
        "conversations/<int:pk>/leave/",
        LeaveConversationView.as_view(),
        name="leave-conversation",
    ),
    path(
        "conversations/<int:pk>/rename/",
        RenameConversationView.as_view(),
        name="rename-conversation",
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
    path(
        "conversations/<int:conversation_id>/unread/",
        MarkMessagesUnreadView.as_view(),
        name="mark-unread",
    ),
    path("unread-count/", UnreadCountView.as_view(), name="unread-count"),
    path("messages/<int:message_id>/edit/", MessageEditView.as_view(), name="message-edit"),
    path(
        "messages/<int:message_id>/unsend/",
        MessageUnsendView.as_view(),
        name="message-unsend",
    ),
    path(
        "messages/<int:message_id>/react/",
        MessageReactionToggleView.as_view(),
        name="message-react",
    ),
    path(
        "messages/<int:message_id>/unread/",
        MarkMessageUnreadView.as_view(),
        name="message-mark-unread",
    ),
]
