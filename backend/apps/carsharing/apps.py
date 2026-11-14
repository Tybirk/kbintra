from django.apps import AppConfig


class CarSharingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.carsharing"
    verbose_name = "Bildeling"

    def ready(self) -> None:
        import apps.carsharing.tasks  # noqa: F401 — register periodic tasks with Huey
