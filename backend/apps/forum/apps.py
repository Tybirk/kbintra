from django.apps import AppConfig


class ForumConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.forum"

    def ready(self) -> None:
        # Importing the tasks module registers the Huey @db_task callables so
        # they're available to call from the rest of the codebase.
        from apps.forum import tasks  # noqa: F401
