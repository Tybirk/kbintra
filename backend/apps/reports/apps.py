from django.apps import AppConfig


class ReportsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.reports"
    verbose_name = "Indrapportering"

    def ready(self) -> None:
        # Import so Huey registers the thumbnail task at startup.
        from . import tasks  # noqa: F401
