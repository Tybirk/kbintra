"""
Food team generation service.

This module contains the algorithm for generating food teams based on user wishes.
It is a faithful port of the standalone ``madhold.py`` scheduler (unit-based greedy
assignment with swap repair, overflow placement, rebalancing, and max-old
auto-escalation), adapted to the Django models.

Algorithm constraints:
- Target ``TEAM_SIZE`` (6) members per team.
- No two people from the same house on the same date, unless they are a "couple"
  (both housemates flagged ``prefers_cooking_with_housemate``) placed together.
- At most ``MAX_OLD_PER_DAY`` "over 50" people per team (auto-escalates on failure).
- At most ``MAX_HEADCHEFS_PER_DAY`` head chefs per team; rebalancing tries to give
  every team at least one head chef.
- People with the fewest available dates are assigned first.

Couples are modelled as two-member "units" scheduled on the intersection of both
partners' available dates; everyone else is a one-member unit.
"""

from dataclasses import dataclass, field
from datetime import date

from django.db import transaction

from apps.food.models import (
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    FoodTeamWish,
)
from apps.users.models import User


@dataclass
class PersonData:
    """Data about a person for team assignment."""

    user_id: int
    house_id: int | None
    house_number: str
    first_name: str
    is_over_50: bool
    can_be_head_chef: bool
    prefers_housemate: bool
    can_be_switched: bool
    available_dates: list[date] = field(default_factory=list)


@dataclass
class TeamGenerationResult:
    """Result of team generation."""

    success: bool
    message: str
    teams_created: int = 0
    unassigned_persons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# A unit is a tuple of member user-ids (1 for singles, 2 for couples) plus the
# list of dates valid for the whole unit.
Unit = tuple[tuple[int, ...], list[date]]


class TeamGenerator:
    """
    Generates food teams for a cycle based on user wishes.

    Port of the ``madhold.py`` ``Scheduler``. The public surface
    (``cooking_dates``, ``persons``, ``load_data``, ``is_valid_assignment``,
    ``assign_person``, ``generate``) is preserved for the views, serializers and
    tests that depend on it.
    """

    # --- Configurable scheduling constants (match madhold.py defaults) ------ #
    TEAM_SIZE = 6
    OVERFLOW = 1
    MAX_HEADCHEFS_PER_DAY = 3
    MAX_OLD_PER_DAY_START = 2
    MAX_OLD_PER_DAY_CEILING = 4
    REBALANCE_ITERATIONS = 100

    # Backwards-compatible aliases (older code / tests may reference these).
    MIN_TEAM_SIZE = TEAM_SIZE
    MAX_OVER_50_PER_TEAM = MAX_OLD_PER_DAY_START
    MIN_HEAD_CHEFS_PER_TEAM = 1

    def __init__(self, cycle: FoodTeamCycle):
        self.cycle = cycle
        # Convert ISO strings to date objects.
        self.cooking_dates = [date.fromisoformat(d) for d in cycle.cooking_dates]
        self.cooking_dates_set: set[date] = set(self.cooking_dates)

        # Person data (populated by load_data).
        self.persons: dict[int, PersonData] = {}
        self.special_persons: list[int] = []  # want to cook with their housemate
        self.regular_persons: list[int] = []  # everyone else

        # The active over-50 cap; raised between auto-escalation attempts.
        self.max_old: int = self.MAX_OLD_PER_DAY_START

        # Assignment tracking (reset per attempt by _reset_assignment).
        self.date_to_persons: dict[date, list[int]] = {d: [] for d in self.cooking_dates}
        self.date_to_old_count: dict[date, int] = dict.fromkeys(self.cooking_dates, 0)
        self.date_to_head_chef_count: dict[date, int] = dict.fromkeys(self.cooking_dates, 0)

        # Results.
        self.unassigned: list[int] = []
        self.warnings: list[str] = []

    # ---- data loading ----------------------------------------------------- #

    def load_data(self) -> None:
        """Load persons and their wishes from the database."""
        users = User.objects.filter(is_exempt_from_food_teams=False).select_related("house")

        wishes = {w.user_id: w for w in FoodTeamWish.objects.filter(cycle=self.cycle)}

        for user in users:
            wish = wishes.get(user.id)

            # New rule: a wish flagged is_unavailable opts the user out of this
            # cycle entirely — skip them completely.
            if wish is not None and wish.is_unavailable:
                continue

            house_number = ""
            if user.house:
                # Extract number from house name like "House 5".
                house_number = user.house.name.replace("House ", "")

            # Available dates come from the wish (filtered to cooking dates); if
            # the user submitted no wish, they default to ALL cooking dates.
            available_dates: list[date] = []
            if wish is not None:
                available_dates = [
                    parsed
                    for d in wish.available_dates
                    if (parsed := date.fromisoformat(d)) in self.cooking_dates_set
                ]
            if not available_dates:
                available_dates = list(self.cooking_dates)

            person = PersonData(
                user_id=user.id,
                house_id=user.house_id,
                house_number=house_number,
                first_name=user.first_name,
                is_over_50=user.is_over_50,
                can_be_head_chef=user.can_be_head_chef,
                prefers_housemate=user.prefers_cooking_with_housemate,
                # Couples are not freely swapped; singles are.
                can_be_switched=not user.prefers_cooking_with_housemate,
                available_dates=available_dates,
            )
            self.persons[user.id] = person

            if person.prefers_housemate:
                self.special_persons.append(user.id)
            else:
                self.regular_persons.append(user.id)

    def _reset_assignment(self) -> None:
        """Clear all per-attempt assignment state (used before each escalation)."""
        self.date_to_persons = {d: [] for d in self.cooking_dates}
        self.date_to_old_count = dict.fromkeys(self.cooking_dates, 0)
        self.date_to_head_chef_count = dict.fromkeys(self.cooking_dates, 0)
        self.unassigned = []
        # Couples may have been degraded to singles during a previous attempt; the
        # can_be_switched flag is reset to its load-time value so each attempt is
        # independent.
        for person in self.persons.values():
            person.can_be_switched = not person.prefers_housemate

    # ---- core mutators ---------------------------------------------------- #

    def assign_person(self, user_id: int, d: date) -> None:
        """Assign a person to a date."""
        person = self.persons[user_id]
        self.date_to_persons[d].append(user_id)
        if person.is_over_50:
            self.date_to_old_count[d] += 1
        if person.can_be_head_chef:
            self.date_to_head_chef_count[d] += 1

    def remove_person(self, user_id: int, d: date) -> None:
        """Remove a person from a date."""
        person = self.persons[user_id]
        self.date_to_persons[d].remove(user_id)
        if person.is_over_50:
            self.date_to_old_count[d] -= 1
        if person.can_be_head_chef:
            self.date_to_head_chef_count[d] -= 1

    def switch_persons(
        self, person_id: int, from_date: date, switch_id: int, switch_date: date
    ) -> None:
        """Swap two people between their dates."""
        self.remove_person(person_id, from_date)
        self.remove_person(switch_id, switch_date)
        self.assign_person(person_id, switch_date)
        self.assign_person(switch_id, from_date)

    # ---- constraint checks ------------------------------------------------ #

    def is_valid_assignment(self, user_id: int, d: date) -> bool:
        """Check if assigning a single person to a date is valid."""
        person = self.persons[user_id]
        # No two from the same house on the same date.
        for other_id in self.date_to_persons[d]:
            other = self.persons[other_id]
            if person.house_id is not None and person.house_id == other.house_id:
                return False
        if person.is_over_50 and self.date_to_old_count[d] >= self.max_old:
            return False
        return not (
            person.can_be_head_chef
            and self.date_to_head_chef_count[d] >= self.MAX_HEADCHEFS_PER_DAY
        )

    def is_valid_switch(
        self, person_id: int, from_date: date, switch_id: int, switch_date: date
    ) -> bool:
        """Check if swapping two people between dates is valid."""
        person = self.persons[person_id]
        switch_person = self.persons[switch_id]

        if not (person.can_be_switched and switch_person.can_be_switched):
            return False
        # Each must actually want the date they would move to.
        if from_date not in switch_person.available_dates:
            return False
        if switch_date not in person.available_dates:
            return False

        same_house = person.house_id is not None and person.house_id == switch_person.house_id

        # No house-mate on the destination date (unless they are the swap partner).
        if not same_house:
            for other_id in self.date_to_persons[switch_date]:
                if other_id == switch_id:
                    continue
                other = self.persons[other_id]
                if person.house_id is not None and person.house_id == other.house_id:
                    return False
            for other_id in self.date_to_persons[from_date]:
                if other_id == person_id:
                    continue
                other = self.persons[other_id]
                if switch_person.house_id is not None and switch_person.house_id == other.house_id:
                    return False

        # Old-person balance: don't pile too many old people on one date via a swap.
        if (
            person.is_over_50
            and not switch_person.is_over_50
            and self.date_to_old_count[switch_date] > 2
        ):
            return False
        if (
            switch_person.is_over_50
            and not person.is_over_50
            and self.date_to_old_count[from_date] > 2
        ):
            return False

        # Don't strip the last head chef from either side. (madhold.py fixed a
        # copy/paste bug here: the second branch must test `person`, not the
        # switch person.)
        if (
            self.date_to_head_chef_count[from_date] <= 1
            and person.can_be_head_chef
            and not switch_person.can_be_head_chef
        ):
            return False
        return not (
            self.date_to_head_chef_count[switch_date] <= 1
            and switch_person.can_be_head_chef
            and not person.can_be_head_chef
        )

    # ---- units (singles + couples handled uniformly) --------------------- #

    def _build_units(self) -> list[Unit]:
        """
        Build the list of (members, valid_dates) units.

        A single is a one-member unit with that person's wishes; a couple is a
        two-member unit (two housemates who both want to cook together) scheduled
        on the *intersection* of both partners' wishes. Couples without a partner
        or without common dates are degraded to singles with a warning (web action,
        so we never hard-fail).
        """
        units: list[Unit] = []
        placed: set[int] = set()

        for user_id in self.special_persons:
            if user_id in placed:
                continue
            person = self.persons[user_id]

            partner_id = next(
                (
                    other_id
                    for other_id in self.special_persons
                    if other_id != user_id
                    and other_id not in placed
                    and person.house_id is not None
                    and self.persons[other_id].house_id == person.house_id
                ),
                None,
            )

            if partner_id is None:
                # No matching housemate — treat as a single.
                self.warnings.append(
                    f"{person.first_name} ønskede at lave mad med en medbeboer, men "
                    f"ingen anden i huset har samme ønske. Planlægges alene."
                )
                units.append(((user_id,), list(person.available_dates)))
                person.can_be_switched = True
                placed.add(user_id)
                continue

            partner = self.persons[partner_id]
            partner_dates = set(partner.available_dates)
            common = [d for d in person.available_dates if d in partner_dates]

            if not common:
                # No overlapping dates — degrade both to singles with a warning.
                self.warnings.append(
                    f"{person.first_name} og {partner.first_name} ønskede at lave mad "
                    f"sammen, men har ingen fælles ledige datoer. Planlægges hver for sig."
                )
                for pid in (user_id, partner_id):
                    p = self.persons[pid]
                    units.append(((pid,), list(p.available_dates)))
                    p.can_be_switched = True
                    placed.add(pid)
                continue

            units.append(((user_id, partner_id), common))
            placed.add(user_id)
            placed.add(partner_id)

        for user_id in self.regular_persons:
            units.append(((user_id,), list(self.persons[user_id].available_dates)))

        return units

    def _unit_fits(self, members: tuple[int, ...], d: date) -> bool:
        """
        Like is_valid_assignment, but handles a couple atomically: partners share
        a house, so the house-collision check ignores them as 'each other', and the
        old/headchef caps account for both members at once.
        """
        houses = {self.persons[m].house_id for m in members if self.persons[m].house_id is not None}
        for other_id in self.date_to_persons[d]:
            other_house = self.persons[other_id].house_id
            if other_house is not None and other_house in houses:
                return False
        added_old = sum(self.persons[m].is_over_50 for m in members)
        if self.date_to_old_count[d] + added_old > self.max_old:
            return False
        added_chef = sum(self.persons[m].can_be_head_chef for m in members)
        return self.date_to_head_chef_count[d] + added_chef <= self.MAX_HEADCHEFS_PER_DAY

    def _place_unit(self, members: tuple[int, ...], d: date) -> None:
        for m in members:
            self.assign_person(m, d)

    # ---- phases ----------------------------------------------------------- #

    def assign_greedy(self) -> list[Unit]:
        """
        Single greedy pass over all units (couples + singles together).

        Order: fewest valid dates first, then head chefs first (spread them out),
        then over-50 first (honour the cap before slots fill). Within each unit,
        pick the least-filled valid date (most slack); ties broken by fewest head
        chefs already there. Returns the units that couldn't be placed.
        """
        units = self._build_units()

        def unit_key(unit: Unit) -> tuple[int, bool, bool]:
            members, options = unit
            return (
                len(options),
                not any(self.persons[m].can_be_head_chef for m in members),
                not any(self.persons[m].is_over_50 for m in members),
            )

        units.sort(key=unit_key)

        unplaced: list[Unit] = []
        for members, options in units:
            best: date | None = None
            best_score: tuple[int, int] | None = None
            for d in options:
                if not self._unit_fits(members, d):
                    continue
                slack = self.TEAM_SIZE - len(self.date_to_persons[d])
                if slack <= 0:
                    continue
                score = (slack, -self.date_to_head_chef_count[d])
                if best_score is None or score > best_score:
                    best_score = score
                    best = d

            if best is None:
                unplaced.append((members, options))
                continue

            self._place_unit(members, best)

        return unplaced

    def flatten_unplaced(self, unplaced_units: list[Unit]) -> list[int]:
        """
        Flatten unplaced units into individual user-ids. Any couple that ended up
        unplaced is degraded to singles for the repair passes.
        """
        flat: list[int] = []
        for members, _ in unplaced_units:
            if len(members) > 1:
                names = " og ".join(self.persons[m].first_name for m in members)
                self.warnings.append(
                    f"Parret {names} kunne ikke placeres sammen; planlægges hver for sig."
                )
                for m in members:
                    self.persons[m].can_be_switched = True
            flat.extend(members)
        return flat

    def resolve_via_swaps(self, unassigned: list[int]) -> list[int]:
        """Repair unplaced people by displacing someone to a short date."""
        for user_id in list(unassigned):
            short_dates = [d for d, ps in self.date_to_persons.items() if len(ps) < self.TEAM_SIZE]
            person = self.persons[user_id]
            placed_here = False

            for d in person.available_dates:
                if d in short_dates and self.is_valid_assignment(user_id, d):
                    self.assign_person(user_id, d)
                    placed_here = True
                    break

                # Try to displace someone currently on `d` to a short date.
                for assigned_id in list(self.date_to_persons[d]):
                    can_move_to = set(self.persons[assigned_id].available_dates) & set(short_dates)
                    for move_to in can_move_to:
                        if self.is_valid_assignment(assigned_id, move_to) and self.is_valid_switch(
                            user_id, move_to, assigned_id, d
                        ):
                            self.remove_person(assigned_id, d)
                            self.assign_person(assigned_id, move_to)
                            self.assign_person(user_id, d)
                            placed_here = True
                            break
                    if placed_here:
                        break
                if placed_here:
                    break

        return self.get_unassigned()

    def overflow_remaining(self, unassigned: list[int]) -> list[int]:
        """Place leftovers allowing up to team_size + overflow per date."""
        cap = self.TEAM_SIZE + self.OVERFLOW
        for user_id in list(unassigned):
            person = self.persons[user_id]
            for d in person.available_dates:
                if len(self.date_to_persons[d]) < cap and self.is_valid_assignment(user_id, d):
                    self.assign_person(user_id, d)
                    break
        return self.get_unassigned()

    def rebalance(self) -> None:
        """Rebalance over-50 people and head chefs across dates."""
        for _ in range(self.REBALANCE_ITERATIONS):
            changed = False

            # --- over-50 rebalance --- #
            for d in self.cooking_dates:
                if self.date_to_old_count[d] <= 2:
                    continue
                moved = False
                for user_id in list(self.date_to_persons[d]):
                    if not self.persons[user_id].is_over_50:
                        continue
                    for other_date in self.persons[user_id].available_dates:
                        if other_date == d or self.date_to_old_count[other_date] > 1:
                            continue
                        for other_id in list(self.date_to_persons[other_date]):
                            if self.persons[other_id].is_over_50:
                                continue
                            if self.is_valid_switch(user_id, d, other_id, other_date):
                                self.switch_persons(user_id, d, other_id, other_date)
                                changed = True
                                moved = True
                                break
                        if moved:
                            break
                    if moved:
                        break

            # --- head-chef rebalance --- #
            for d in self.cooking_dates:
                if self.date_to_head_chef_count[d] != 0:
                    continue
                done = False
                for user_id in list(self.date_to_persons[d]):
                    if done:
                        break
                    for other_date in self.persons[user_id].available_dates:
                        if other_date == d or self.date_to_head_chef_count[other_date] <= 1:
                            continue
                        for other_id in list(self.date_to_persons[other_date]):
                            if not self.persons[other_id].can_be_head_chef:
                                continue
                            if self.is_valid_switch(user_id, d, other_id, other_date):
                                self.switch_persons(user_id, d, other_id, other_date)
                                changed = True
                                done = True
                                break
                        if done:
                            break

            if not changed:
                break

    # ---- introspection ---------------------------------------------------- #

    def get_assigned(self) -> set[int]:
        return {p for d in self.cooking_dates for p in self.date_to_persons[d]}

    def get_unassigned(self) -> list[int]:
        assigned = self.get_assigned()
        return [uid for uid in self.persons if uid not in assigned]

    # ---- assignment driver (max-old auto-escalation) --------------------- #

    def run_assignment(self) -> None:
        """
        Run the full assignment, escalating max_old from the start value up to the
        ceiling if anyone remains unplaced after greedy + swaps + overflow. Each
        escalation restarts the assignment from scratch.
        """
        max_old = self.MAX_OLD_PER_DAY_START
        ceiling = self.MAX_OLD_PER_DAY_CEILING

        while True:
            self._reset_assignment()
            self.max_old = max_old

            unplaced_units = self.assign_greedy()
            unassigned = self.flatten_unplaced(unplaced_units)
            if unassigned:
                unassigned = self.resolve_via_swaps(unassigned)
            if unassigned:
                unassigned = self.overflow_remaining(unassigned)
            self.rebalance()

            self.unassigned = self.get_unassigned()

            if not self.unassigned:
                break
            if max_old >= ceiling:
                self.warnings.append(
                    f"Nåede grænsen for over-50 pr. hold ({ceiling}); "
                    f"{len(self.unassigned)} person(er) kunne ikke placeres."
                )
                break

            max_old += 1

    def validate_result(self) -> None:
        """Collect warnings about the final schedule (Danish, user-facing)."""
        for d, members in self.date_to_persons.items():
            if 0 < len(members) < self.TEAM_SIZE:
                self.warnings.append(
                    f"Datoen {d} har kun {len(members)} medlemmer (mål er {self.TEAM_SIZE})."
                )
            if members and self.date_to_head_chef_count[d] == 0:
                self.warnings.append(f"Datoen {d} har ingen chefkok.")
            if self.date_to_old_count[d] > self.max_old:
                self.warnings.append(
                    f"Datoen {d} har {self.date_to_old_count[d]} over-50 medlemmer "
                    f"(maks {self.max_old})."
                )

            # Unintended same-house collisions (couples are expected).
            seen: dict[int, int] = {}
            for uid in members:
                house = self.persons[uid].house_id
                if house is None:
                    continue
                if house in seen:
                    both_couples = (
                        self.persons[uid].prefers_housemate
                        and self.persons[seen[house]].prefers_housemate
                    )
                    if not both_couples:
                        self.warnings.append(f"Datoen {d} har flere personer fra samme hus.")
                seen[house] = uid

    # ---- persistence ------------------------------------------------------ #

    @transaction.atomic
    def save_teams(self) -> int:
        """Save the generated teams to the database."""
        # Delete existing teams for this cycle's dates.
        FoodTeam.objects.filter(date__in=self.cooking_dates).delete()

        teams_created = 0
        for d, member_ids in self.date_to_persons.items():
            if not member_ids:
                continue

            team = FoodTeam.objects.create(cycle=self.cycle, date=d)

            for user_id in member_ids:
                person = self.persons[user_id]
                FoodTeamMember.objects.create(
                    team=team,
                    user_id=user_id,
                    house_number=person.house_number,
                )

            teams_created += 1

        return teams_created

    def generate(self, save: bool = True) -> TeamGenerationResult:
        """Run the full team generation algorithm."""
        try:
            self.load_data()

            if not self.persons:
                return TeamGenerationResult(
                    success=False,
                    message="Ingen kvalificerede personer fundet til holddannelse",
                )

            self.run_assignment()
            self.validate_result()

            teams_created = 0
            if save:
                teams_created = self.save_teams()
                self.cycle.status = CycleStatus.FINALIZED  # ty: ignore[invalid-assignment]
                self.cycle.save()

            unassigned_names = [self.persons[uid].first_name for uid in self.unassigned]

            success = len(self.unassigned) == 0 and not any(
                0 < len(m) < self.TEAM_SIZE for m in self.date_to_persons.values()
            )

            return TeamGenerationResult(
                success=success,
                message=f"Genererede {teams_created} hold"
                if success
                else "Generering gennemført med problemer",
                teams_created=teams_created,
                unassigned_persons=unassigned_names,
                warnings=self.warnings,
            )

        except Exception as e:  # noqa: BLE001 - web action, never let it 500
            return TeamGenerationResult(
                success=False,
                message=f"Fejl under generering: {e!s}",
            )


def generate_teams_for_cycle(cycle: FoodTeamCycle, save: bool = True) -> TeamGenerationResult:
    """
    Convenience function to generate teams for a cycle.

    Args:
        cycle: The FoodTeamCycle to generate teams for.
        save: Whether to save the teams to the database.

    Returns:
        TeamGenerationResult with details about the generation.
    """
    generator = TeamGenerator(cycle)
    return generator.generate(save=save)
