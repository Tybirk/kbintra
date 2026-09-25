from django.contrib import admin

from .models import Report, ReportEvent, ReportPhoto


class ReportPhotoInline(admin.TabularInline):
    model = ReportPhoto
    extra = 0
    fields = ["image", "name", "uploaded_at"]
    readonly_fields = ["uploaded_at"]


class ReportEventInline(admin.TabularInline):
    model = ReportEvent
    extra = 0
    fields = ["kind", "author", "old_status", "new_status", "message", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ["number", "subgroup", "kind", "status", "reporter_name", "created_at"]
    list_filter = ["subgroup", "status", "kind"]
    search_fields = ["description", "location", "legacy_reporter_name"]
    raw_id_fields = ["submitted_by"]
    inlines = [ReportPhotoInline, ReportEventInline]


@admin.register(ReportEvent)
class ReportEventAdmin(admin.ModelAdmin):
    list_display = ["report", "kind", "author", "old_status", "new_status", "created_at"]
    list_filter = ["kind"]
    raw_id_fields = ["report", "author"]
