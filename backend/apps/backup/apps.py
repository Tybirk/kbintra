from django.apps import AppConfig


class BackupConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.backup"
    verbose_name = "Backup"

    def ready(self):
        import apps.backup.signals  # noqa: F401
        import apps.backup.tasks  # noqa: F401
