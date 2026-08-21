"""
Dev helper: put yourself (and optionally others) on a food team for TODAY so
the dashboard action box appears immediately. Idempotent. Pass --clear to undo.

Examples:
    uv run python manage.py spoof_today_food_team sysadmins@accuranker.com
    uv run python manage.py spoof_today_food_team sysadmins@accuranker.com --others 5
    uv run python manage.py spoof_today_food_team sysadmins@accuranker.com --clear
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.food.models import FoodTeam, FoodTeamMember
from apps.food.utils import house_number_for
from apps.users.models import User


def _house_number(user: User) -> str:
    return house_number_for(user.house)


class Command(BaseCommand):
    help = "Create (or clear) a FoodTeam for TODAY and add the given user as a member."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument(
            "user",
            help="Email OR first name of the user to put on today's team.",
        )
        parser.add_argument(
            "--others",
            type=int,
            default=5,
            help="Also add this many random active users for realism (default 5).",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete today's team instead of creating/updating it.",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        today = timezone.localdate()

        if options["clear"]:
            deleted, _ = FoodTeam.objects.filter(date=today).delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} object(s) for {today}."))
            return

        ident = options["user"]
        user = (
            User.objects.filter(email__iexact=ident).first()
            or User.objects.filter(first_name__iexact=ident).first()
        )
        if not user:
            raise CommandError(f"No user matching email or first_name '{ident}'.")

        team, created = FoodTeam.objects.get_or_create(
            date=today,
            defaults={"notes": "Spoofed for dashboard testing"},
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if created else 'Reusing'} FoodTeam for {today} (id={team.id})."
            )
        )

        FoodTeamMember.objects.get_or_create(
            team=team,
            user=user,
            defaults={"house_number": _house_number(user)},
        )

        if options["others"] > 0:
            already = set(team.members.values_list("user_id", flat=True))
            others = (
                User.objects.filter(is_active=True)
                .exclude(id__in=already)
                .order_by("?")[: options["others"]]
            )
            for u in others:
                FoodTeamMember.objects.get_or_create(
                    team=team,
                    user=u,
                    defaults={"house_number": _house_number(u)},
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Today's team now has {team.members.count()} members "
                f"(including {user.first_name}). Reload the dashboard."
            )
        )
