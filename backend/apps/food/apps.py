from django.apps import AppConfig


class FoodConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.food"

    def ready(self) -> None:
        import apps.food.tasks  # noqa: F401 — register periodic Huey tasks
