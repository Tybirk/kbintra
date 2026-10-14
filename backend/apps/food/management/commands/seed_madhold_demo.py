"""
Dev helper: a demo madhold week to take screenshots of.

Puts the named user on the coming Monday's team and their housemate on the
coming Thursday's, so both "Mine hold" and the new "Min husstand" section have
something to show. ``--today`` also puts the user on a team dated today, which
is what lights up the action box on the front page.

Everything it creates is marked in ``FoodTeam.notes``, and ``--clear`` removes
exactly that — real teams on the same days are left alone.

Examples:
    uv run python manage.py seed_madhold_demo peteremiltybirk@gmail.com
    uv run python manage.py seed_madhold_demo Peter --today
    uv run python manage.py seed_madhold_demo Peter --clear
"""

from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.food.models import CycleStatus, FoodTeam, FoodTeamCycle, FoodTeamMember
from apps.food.utils import house_number_for, housemates_of
from apps.users.models import User

DEMO_MARKER = "[demo]"
DEMO_CYCLE_NAME = "Demo-periode (screenshots)"


class Command(BaseCommand):
    help = "Seed a demo madhold week for the given user and their housemate (dev only)."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument("user", help="Email OR first name of the user to build the demo for.")
        parser.add_argument(
            "--today",
            action="store_true",
            help="Also put the user on a team dated today (front-page action box).",
        )
        parser.add_argument(
            "--others",
            type=int,
            default=5,
            help="Extra residents to fill each team with, for realism (default 5).",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete everything this command created and stop.",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        if options["clear"]:
            self._clear()
            return

        user = self._find_user(options["user"])
        housemate = housemates_of(user).first()

        today = timezone.localdate()
        monday = today + timedelta(days=((0 - today.weekday()) % 7) or 7)
        thursday = monday + timedelta(days=3)

        with transaction.atomic():
            cycle = self._demo_cycle(user, monday)

            self._team(monday, cycle, [user], options["others"])
            self.stdout.write(self.style.SUCCESS(f"{user.first_name} laver mad mandag {monday}."))

            if housemate:
                self._team(thursday, cycle, [housemate], options["others"])
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{housemate.first_name} (samme hus) laver mad torsdag {thursday}."
                    )
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"{user.first_name} has no housemate — skipping the Thursday team. "
                        '"Min husstand" will stay empty.'
                    )
                )

            if options["today"]:
                self._team(today, cycle, [user], options["others"])
                self.stdout.write(
                    self.style.SUCCESS(f"{user.first_name} laver også mad I DAG ({today}).")
                )

        self.stdout.write("Reload /madhold (and the front page with --today).")

    # ---- helpers ---------------------------------------------------------- #

    def _find_user(self, ident: str) -> User:
        user = (
            User.objects.filter(email__iexact=ident).first()
            or User.objects.filter(first_name__iexact=ident).first()
        )
        if not user:
            raise CommandError(f"No user matching email or first_name '{ident}'.")
        return user

    def _demo_cycle(self, user: User, monday: date) -> FoodTeamCycle:
        cycle, _ = FoodTeamCycle.objects.get_or_create(
            name=DEMO_CYCLE_NAME,
            defaults={
                "cooking_dates": [(monday + timedelta(days=d)).isoformat() for d in range(4)],
                "wish_deadline": timezone.now(),
                "status": CycleStatus.FINALIZED,
                "created_by": user,
            },
        )
        return cycle

    def _team(
        self, day: date, cycle: FoodTeamCycle, must_include: list[User], others: int
    ) -> FoodTeam:
        """Team for ``day`` with these people on it, topped up to look real."""
        team, created = FoodTeam.objects.get_or_create(
            date=day,
            defaults={"cycle": cycle, "notes": f"{DEMO_MARKER} seeded for screenshots"},
        )
        if not created and DEMO_MARKER not in team.notes:
            self.stdout.write(
                self.style.WARNING(f"Reusing the real team on {day} — --clear will not remove it.")
            )

        for person in must_include:
            FoodTeamMember.objects.get_or_create(
                team=team, user=person, defaults={"house_number": house_number_for(person.house)}
            )

        if others > 0:
            already = set(team.members.values_list("user_id", flat=True))
            fillers = (
                User.objects.filter(is_active=True).exclude(id__in=already).order_by("?")[:others]
            )
            for filler in fillers:
                FoodTeamMember.objects.get_or_create(
                    team=team,
                    user=filler,
                    defaults={"house_number": house_number_for(filler.house)},
                )

        return team

    def _clear(self) -> None:
        teams = FoodTeam.objects.filter(notes__contains=DEMO_MARKER)
        count = teams.count()
        teams.delete()
        cycles, _ = FoodTeamCycle.objects.filter(name=DEMO_CYCLE_NAME).delete()
        self.stdout.write(
            self.style.SUCCESS(f"Deleted {count} demo team(s) and {cycles} cycle object(s).")
        )
