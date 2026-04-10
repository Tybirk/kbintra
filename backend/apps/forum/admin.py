"""
Admin configuration for Forum models.
"""

from django.contrib import admin

from .models import (
    File,
    Folder,
    Poll,
    PollOption,
    PollVote,
    Post,
    Subgroup,
    SubgroupMembership,
    SubgroupSubscription,
    Thread,
    ThreadReadStatus,
)


@admin.register(Subgroup)
class SubgroupAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "slug",
        "is_default",
        "allows_members",
        "default_members_only",
        "created_at",
    ]
    list_filter = ["is_default", "allows_members", "default_members_only"]
    search_fields = ["name", "description"]
    prepopulated_fields = {"slug": ("name",)}


@admin.register(SubgroupSubscription)
class SubgroupSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "subgroup", "notify_new_threads", "notify_replies", "created_at"]
    list_filter = ["subgroup", "notify_new_threads", "notify_replies"]
    search_fields = ["user__first_name", "user__last_name", "user__email", "subgroup__name"]
    raw_id_fields = ["user", "subgroup"]


@admin.register(SubgroupMembership)
class SubgroupMembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "subgroup", "role", "created_at"]
    list_filter = ["subgroup", "role"]
    search_fields = ["user__first_name", "user__last_name", "user__email", "subgroup__name"]
    raw_id_fields = ["user", "subgroup"]


@admin.register(Thread)
class ThreadAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "subgroup",
        "author",
        "is_pinned",
        "is_closed",
        "created_at",
        "updated_at",
    ]
    list_filter = ["subgroup", "is_pinned", "is_closed", "created_at"]
    search_fields = ["title", "author__email"]
    raw_id_fields = ["author", "subgroup"]
    date_hierarchy = "created_at"


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ["id", "thread", "author", "created_at", "updated_at"]
    list_filter = ["created_at"]
    search_fields = ["content", "author__email", "thread__title"]
    raw_id_fields = ["author", "thread"]
    date_hierarchy = "created_at"


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ["name", "subgroup", "parent", "created_at"]
    list_filter = ["subgroup"]
    search_fields = ["name"]
    raw_id_fields = ["subgroup", "parent"]


class PollOptionInline(admin.TabularInline):
    model = PollOption
    extra = 2


@admin.register(Poll)
class PollAdmin(admin.ModelAdmin):
    list_display = [
        "question",
        "post",
        "created_by",
        "allow_multiple_votes",
        "is_anonymous",
        "created_at",
    ]
    list_filter = ["allow_multiple_votes", "is_anonymous"]
    search_fields = ["question"]
    raw_id_fields = ["post", "created_by"]
    inlines = [PollOptionInline]


@admin.register(PollOption)
class PollOptionAdmin(admin.ModelAdmin):
    list_display = ["text", "poll", "order"]
    raw_id_fields = ["poll"]


@admin.register(PollVote)
class PollVoteAdmin(admin.ModelAdmin):
    list_display = ["user", "option", "created_at"]
    raw_id_fields = ["option", "user"]


@admin.register(ThreadReadStatus)
class ThreadReadStatusAdmin(admin.ModelAdmin):
    list_display = ["user", "thread", "last_read_at"]
    list_filter = ["last_read_at"]
    search_fields = ["user__email", "thread__title"]
    raw_id_fields = ["user", "thread"]


@admin.register(File)
class FileAdmin(admin.ModelAdmin):
    list_display = ["name", "folder", "uploaded_by", "uploaded_at"]
    list_filter = ["uploaded_at"]
    search_fields = ["name", "uploaded_by__email"]
    raw_id_fields = ["folder", "uploaded_by"]
    date_hierarchy = "uploaded_at"
