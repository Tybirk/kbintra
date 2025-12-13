"""
Admin configuration for Forum models.
"""

from django.contrib import admin

from .models import File, Folder, Post, Subgroup, SubgroupSubscription, Thread


@admin.register(Subgroup)
class SubgroupAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "is_default", "created_at"]
    list_filter = ["is_default"]
    search_fields = ["name", "description"]
    prepopulated_fields = {"slug": ("name",)}


@admin.register(SubgroupSubscription)
class SubgroupSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "subgroup", "notify_new_threads", "notify_replies", "created_at"]
    list_filter = ["subgroup", "notify_new_threads", "notify_replies"]
    search_fields = ["user__email", "subgroup__name"]
    raw_id_fields = ["user", "subgroup"]


@admin.register(Thread)
class ThreadAdmin(admin.ModelAdmin):
    list_display = ["title", "subgroup", "author", "is_pinned", "created_at", "updated_at"]
    list_filter = ["subgroup", "is_pinned", "created_at"]
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


@admin.register(File)
class FileAdmin(admin.ModelAdmin):
    list_display = ["name", "folder", "uploaded_by", "uploaded_at"]
    list_filter = ["uploaded_at"]
    search_fields = ["name", "uploaded_by__email"]
    raw_id_fields = ["folder", "uploaded_by"]
    date_hierarchy = "uploaded_at"
