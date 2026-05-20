from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.users"

    def ready(self) -> None:
        # Register Huey tasks and the profile-picture thumbnail signals.
        from apps.users import signals, tasks  # noqa: F401
