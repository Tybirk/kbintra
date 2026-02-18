from django.apps import AppConfig


class EventsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.events"

    def ready(self) -> None:
        import apps.events.tasks  # noqa: F401 — register periodic tasks with Huey
