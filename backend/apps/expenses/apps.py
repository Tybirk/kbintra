from django.apps import AppConfig


class ExpensesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.expenses"
    verbose_name = "Udlæg"

    def ready(self) -> None:
        # Import so Huey registers the task at startup.
        from . import tasks  # noqa: F401
