from django.apps import AppConfig


class HousesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.houses"

    def ready(self) -> None:
        # Register Huey tasks and the profile-picture thumbnail signals.
        from apps.houses import signals, tasks  # noqa: F401
