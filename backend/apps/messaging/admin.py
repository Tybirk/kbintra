"""
Admin configuration for Messaging app.
"""

from django.contrib import admin

from .models import Conversation, Message, MessageReadStatus


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    readonly_fields = ["sender", "content", "created_at"]
    can_delete = False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ["id", "get_participants", "message_count", "created_at", "updated_at"]
    list_filter = ["created_at"]
    search_fields = ["participants__first_name", "participants__last_name", "participants__email"]
    filter_horizontal = ["participants"]
    inlines = [MessageInline]

    def get_participants(self, obj):
        return ", ".join([p.first_name for p in obj.participants.all()[:4]])
    get_participants.short_description = "Participants"

    def message_count(self, obj):
        return obj.messages.count()
    message_count.short_description = "Messages"


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ["id", "conversation", "sender", "content_preview", "created_at"]
    list_filter = ["created_at", "sender"]
    search_fields = ["content", "sender__first_name", "sender__last_name"]
    raw_id_fields = ["conversation", "sender"]

    def content_preview(self, obj):
        return obj.content[:50] + "..." if len(obj.content) > 50 else obj.content
    content_preview.short_description = "Content"


@admin.register(MessageReadStatus)
class MessageReadStatusAdmin(admin.ModelAdmin):
    list_display = ["id", "message", "user", "read_at"]
    list_filter = ["read_at"]
    raw_id_fields = ["message", "user"]
