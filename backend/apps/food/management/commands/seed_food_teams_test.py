"""
Seed a realistic food-team test scenario (development only).

Builds a cycle of 16 cooking days (the next four Mon–Thu weeks, skipping
ClosedFoodDays), optionally (re)configures the food-team flags across users
(head chefs, exempt, couples, over-50), and simulates that a given percentage
of residents submitted date wishes. Optionally runs the generator at the end.

Example:
    uv run python manage.py seed_food_teams_test \
        --wish-pct 70 --headchef-pct 20 --couples 4 --over50-pct 15 --generate
"""

import random
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.food.models import (
    CycleStatus,
    FoodTeamCycle,
    FoodTeamWish,
)
from apps.food.services.team_generator import generate_teams_for_cycle
from apps.users.models import User

COOKING_DAYS_PER_CYCLE = 16  # 4 weeks × Mon–Thu


class Command(BaseCommand):
    help = "Seed a food-team cycle with simulated wishes for testing (dev only)."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument(
            "--start",
            type=str,
            default="",
            help="ISO date to start the cycle from (defaults to next Monday).",
        )
        parser.add_argument(
            "--name",
            type=str,
            default="",
            help="Cycle name (defaults to a Danish month range).",
        )
        parser.add_argument(
            "--wish-pct",
            type=int,
            default=70,
            help="Percent of active users who submit a wish (default 70).",
        )
        parser.add_argument(
            "--headchef-pct",
            type=int,
            default=-1,
            help="If >=0, reset can_be_head_chef so this %% of users are head chefs.",
        )
        parser.add_argument(
            "--exempt-pct",
            type=int,
            default=-1,
            help="If >=0, reset is_exempt_from_food_teams so this %% are exempt.",
        )
        parser.add_argument(
            "--over50-pct",
            type=int,
            default=-1,
            help="If >=0, reset is_over_50 so this %% are over 50.",
        )
        parser.add_argument(
            "--couples",
            type=int,
            default=-1,
            help="If >=0, set prefers_cooking_with_housemate on this many full houses.",
        )
        parser.add_argument(
            "--unavailable",
            type=int,
            default=0,
            help="Number of wishing users to mark as unavailable this cycle.",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=42,
            help="Random seed for reproducibility (default 42).",
        )
        parser.add_argument(
            "--generate",
            action="store_true",
            help="Run the team generator after seeding and print the result.",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        rng = random.Random(options["seed"])

        cooking_dates = self._build_cooking_dates(options["start"])
        self.stdout.write(
            f"Cooking days ({len(cooking_dates)}): {cooking_dates[0]} … {cooking_dates[-1]}"
        )

        users = list(User.objects.filter(is_active=True).select_related("house"))
        if not users:
            raise CommandError("No active users found.")

        self._configure_flags(rng, users, options)

        with transaction.atomic():
            cycle = self._create_cycle(cooking_dates, options["name"])
            self._simulate_wishes(rng, cycle, cooking_dates, users, options)

        self.stdout.write(self.style.SUCCESS(f"Created cycle '{cycle.name}' (id={cycle.id})."))

        if options["generate"]:
            self.stdout.write("Running generator…")
            result = generate_teams_for_cycle(cycle, save=True)
            style = self.style.SUCCESS if result.success else self.style.WARNING
            self.stdout.write(style(result.message))
            self.stdout.write(f"  Hold oprettet: {result.teams_created}")
            if result.unassigned_persons:
                self.stdout.write(
                    self.style.WARNING(f"  Ikke placeret: {', '.join(result.unassigned_persons)}")
                )
            for w in result.warnings:
                self.stdout.write(self.style.WARNING(f"  ⚠ {w}"))

    # ------------------------------------------------------------------ #

    def _build_cooking_dates(self, start_str: str) -> list[str]:
        """16 cooking days (Mon–Thu) starting from the next Monday, skipping closed days."""
        from apps.food.services.cycle_planning import next_cooking_dates

        if start_str:
            start = date.fromisoformat(start_str)
        else:
            today = timezone.localdate()
            start = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
        # Snap to Monday.
        start -= timedelta(days=start.weekday())
        return next_cooking_dates(COOKING_DAYS_PER_CYCLE, start=start)

    def _configure_flags(self, rng, users: list, options: dict) -> None:  # type: ignore[no-untyped-def]
        def apply_pct(field: str, pct: int) -> None:
            if pct < 0:
                return
            chosen = set(rng.sample(range(len(users)), k=round(len(users) * pct / 100)))
            for i, u in enumerate(users):
                setattr(u, field, i in chosen)
                u.save(update_fields=[field])
            self.stdout.write(f"  Set {field} on {len(chosen)}/{len(users)} users.")

        apply_pct("can_be_head_chef", options["headchef_pct"])
        apply_pct("is_exempt_from_food_teams", options["exempt_pct"])
        apply_pct("is_over_50", options["over50_pct"])

        couples = options["couples"]
        if couples >= 0:
            # Reset all, then flag both inhabitants of N houses that have >=2 people.
            User.objects.update(prefers_cooking_with_housemate=False)
            from collections import defaultdict

            by_house: dict = defaultdict(list)
            for u in users:
                if u.house_id:
                    by_house[u.house_id].append(u)
            full_houses = [h for h, members in by_house.items() if len(members) >= 2]
            rng.shuffle(full_houses)
            for house_id in full_houses[:couples]:
                for u in by_house[house_id]:
                    u.prefers_cooking_with_housemate = True
                    u.save(update_fields=["prefers_cooking_with_housemate"])
            self.stdout.write(
                f"  Set prefers_cooking_with_housemate on {min(couples, len(full_houses))} houses."
            )

    def _create_cycle(self, cooking_dates: list[str], name: str) -> FoodTeamCycle:
        if not name:
            from apps.food.services.cycle_planning import suggest_cycle_name

            name = suggest_cycle_name(cooking_dates)

        # Clear any existing cycle covering the same first date to stay idempotent.
        # (JSONField __contains is unsupported on SQLite, so filter in Python.)
        for existing in FoodTeamCycle.objects.all():
            if existing.cooking_dates and existing.cooking_dates[0] == cooking_dates[0]:
                existing.delete()

        deadline = timezone.now() + timedelta(days=3)
        return FoodTeamCycle.objects.create(
            name=name,
            cooking_dates=cooking_dates,
            wish_deadline=deadline,
            status=CycleStatus.COLLECTING_WISHES,
        )

    def _simulate_wishes(  # type: ignore[no-untyped-def]
        self, rng, cycle, cooking_dates: list[str], users: list, options: dict
    ) -> None:
        eligible = [u for u in users if not u.is_exempt_from_food_teams]
        n_wish = round(len(eligible) * options["wish_pct"] / 100)
        wishers = rng.sample(eligible, k=min(n_wish, len(eligible)))

        n_unavailable = min(options["unavailable"], len(wishers))
        unavailable = set(rng.sample(range(len(wishers)), k=n_unavailable))

        created = 0
        for i, user in enumerate(wishers):
            if i in unavailable:
                FoodTeamWish.objects.update_or_create(
                    cycle=cycle,
                    user=user,
                    defaults={"available_dates": [], "is_unavailable": True},
                )
                created += 1
                continue
            # Each wisher picks a random plausible subset (3–10 dates).
            k = rng.randint(3, min(10, len(cooking_dates)))
            picks = sorted(rng.sample(cooking_dates, k=k))
            FoodTeamWish.objects.update_or_create(
                cycle=cycle,
                user=user,
                defaults={"available_dates": picks, "is_unavailable": False},
            )
            created += 1

        self.stdout.write(
            f"  Simulated {created} wishes "
            f"({n_unavailable} unavailable); "
            f"{len(eligible) - len(wishers)} eligible users left without a wish "
            f"(treated as available all dates)."
        )
