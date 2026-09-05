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

The generator would rather stop than hand over a schedule that is quietly wrong:
a couple whose flags or wishes can't be honoured, and short teams that could have
been filled from the surplus, both raise SchedulingError instead of being saved.
Teams that are short simply because too few people signed up still go through —
that is an input problem, and it only warns.
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
from apps.food.utils import house_number_for
from apps.users.models import User


class SchedulingError(RuntimeError):
    """
    The schedule that came out is not one we're willing to hand to the house.

    Raised for the two cases where staying quiet would be worse than stopping:
    a couple whose flags or wishes can't be honoured, and a final plan whose
    short teams could demonstrably have been filled from the surplus. The
    message is Danish and actionable — it goes straight to the food admin.
    """


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
    # Trailing dates dropped because there weren't enough cooks (ISO strings).
    # They roll into the next cycle, which starts where this one really ended.
    dropped_dates: list[str] = field(default_factory=list)


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
    # How many hops a size-balancing chain may take (see balance_team_sizes).
    MAX_MOVE_CHAIN = 4

    # Backwards-compatible aliases (older code / tests may reference these).
    MIN_TEAM_SIZE = TEAM_SIZE
    MAX_OVER_50_PER_TEAM = MAX_OLD_PER_DAY_START
    MIN_HEAD_CHEFS_PER_TEAM = 1

    def __init__(
        self, cycle: FoodTeamCycle, allow_couples_without_common_dates: bool = False
    ) -> None:
        self.cycle = cycle
        # Off by default: a couple we can't honour stops the run so the admin can
        # fix the flags or the wishes. Turn it on to schedule such people singly
        # instead, when the deadline matters more than the pairing.
        self.allow_couples_without_common_dates = allow_couples_without_common_dates
        # Convert ISO strings to date objects. ``requested_dates`` is what the
        # admin asked for; ``cooking_dates`` is what we actually staff, which
        # _trim_dates_to_capacity may shorten from the end.
        self.requested_dates = [date.fromisoformat(d) for d in cycle.cooking_dates]
        self.cooking_dates = list(self.requested_dates)
        self.cooking_dates_set: set[date] = set(self.cooking_dates)
        self.dropped_dates: list[date] = []

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

            house_number = house_number_for(user.house)

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
                is_over_50=user.is_over_50_effective,
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

    def _trim_dates_to_capacity(self) -> None:
        """Drop trailing dates the community isn't big enough to staff.

        Teams target ``TEAM_SIZE`` and never go below it on purpose — it is
        better to cook fewer days with full teams (overflowing to
        ``TEAM_SIZE + OVERFLOW``) than to spread everyone thin. So the number of
        dates we can actually staff is ``eligible // TEAM_SIZE``.

        The count is computed here rather than at cycle creation because the
        pool moves in between: people set ``is_unavailable`` on their wish for
        this cycle, or get exempted, after the admin picked the dates.

        Dates are dropped from the *end*, so the leftover ones simply roll into
        the next cycle — ``cycle_planning.suggested_start_date()`` starts the
        day after this cycle's last cooking date, and ``save_teams`` writes the
        trimmed list back to the cycle.
        """
        eligible = len(self.persons)
        if not eligible or not self.cooking_dates:
            return

        capacity_per_date = self.TEAM_SIZE + self.OVERFLOW
        # Enough dates for full teams, but never so few that people can't fit
        # even at the overflow cap (matters only for very small communities).
        usable = max(eligible // self.TEAM_SIZE, -(-eligible // capacity_per_date), 1)
        usable = min(usable, len(self.cooking_dates))
        if usable >= len(self.cooking_dates):
            return

        self.dropped_dates = self.cooking_dates[usable:]
        self.cooking_dates = self.cooking_dates[:usable]
        self.cooking_dates_set = set(self.cooking_dates)

        # Wishes were filtered against the full list in load_data, so re-filter.
        # Anyone whose only wished dates were dropped sits this cycle out rather
        # than being forced onto a day they said they couldn't do — the next
        # cycle starts on exactly those dates, so they are first in line there.
        stood_down: list[str] = []
        for user_id, person in list(self.persons.items()):
            person.available_dates = [
                d for d in person.available_dates if d in self.cooking_dates_set
            ]
            if not person.available_dates:
                stood_down.append(person.first_name)
                del self.persons[user_id]
                for bucket in (self.special_persons, self.regular_persons):
                    if user_id in bucket:
                        bucket.remove(user_id)

        dropped_labels = ", ".join(d.isoformat() for d in self.dropped_dates)
        self.warnings.append(
            f"Der er {eligible} tilmeldte kokke, hvilket rækker til {usable} maddage "
            f"med fulde hold. Følgende datoer er derfor ikke planlagt og rykker til "
            f"næste periode: {dropped_labels}."
        )
        if stood_down:
            self.warnings.append(
                f"{', '.join(stood_down)} ønskede kun de datoer, der rykker til næste "
                f"periode, og er derfor ikke sat på hold denne gang."
            )

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
        # Respect the (possibly escalated) self.max_old, not a hard-coded 2.
        if (
            person.is_over_50
            and not switch_person.is_over_50
            and self.date_to_old_count[switch_date] >= self.max_old
        ):
            return False
        if (
            switch_person.is_over_50
            and not person.is_over_50
            and self.date_to_old_count[from_date] >= self.max_old
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
        on the *intersection* of both partners' wishes. A couple we can't honour —
        no partner with the same flag, or no date they can both cook — raises
        SchedulingError, so the admin fixes the flags rather than finding out later
        that the pair was quietly split; ``allow_couples_without_common_dates``
        degrades them to singles instead.
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
                msg = (
                    f"{person.first_name} (hus {person.house_number}) har sat "
                    f"'vil lave mad med medbeboer', men ingen anden i huset har sat "
                    f"samme ønske. Sæt ønsket på begge, eller fjern det fra "
                    f"{person.first_name}."
                )
                if not self.allow_couples_without_common_dates:
                    raise SchedulingError(msg)
                self.warnings.append(f"{msg} Planlægges alene.")
                units.append(((user_id,), list(person.available_dates)))
                person.can_be_switched = True
                placed.add(user_id)
                continue

            partner = self.persons[partner_id]
            partner_dates = set(partner.available_dates)
            common = [d for d in person.available_dates if d in partner_dates]

            if not common:
                msg = (
                    f"{person.first_name} og {partner.first_name} (hus "
                    f"{person.house_number}) vil lave mad sammen, men har ingen fælles "
                    f"ledige datoer. Lad den ene skrive sig på en af den andens datoer, "
                    f"eller fjern ønsket om at lave mad sammen i denne periode."
                )
                if not self.allow_couples_without_common_dates:
                    raise SchedulingError(msg)
                self.warnings.append(f"{msg} Planlægges hver for sig.")
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
            unit_size = len(members)
            for d in options:
                if not self._unit_fits(members, d):
                    continue
                slack = self.TEAM_SIZE - len(self.date_to_persons[d])
                # Need room for the WHOLE unit (2 for a couple, 1 for a single).
                # The greedy pass must not overflow the target team size; the
                # dedicated overflow pass handles the +OVERFLOW slack later.
                if slack < unit_size:
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

    def balance_team_sizes(self) -> None:
        """
        Even out team sizes once everybody has a date.

        The placement passes can leave one date over target and another under: a
        couple is placed atomically, so if their only remaining option has a single
        free seat they go in as a pair and that date ends up at TEAM_SIZE + 1 — and
        with a fixed number of people, that surplus is someone else's deficit.

        A 1-for-1 switch can never repair this (it keeps both sizes the same), so we
        look for a *chain* instead: someone leaves the over-full date for another
        date they wished for, whoever that date can spare moves on in turn, and so on
        until the chain ends on an under-full date. Every date in the middle keeps its
        size; only the two ends change.
        """
        target = self.TEAM_SIZE

        while True:
            over = [d for d in self.cooking_dates if len(self.date_to_persons[d]) > target]
            under = [d for d in self.cooking_dates if len(self.date_to_persons[d]) < target]
            if not over or not under:
                break

            over.sort(key=lambda d: -len(self.date_to_persons[d]))

            # Iterative deepening, so the shortest working chain wins and we
            # disturb as few already-placed people as possible.
            moved = False
            for depth in range(max(self.MAX_MOVE_CHAIN, 1)):
                for d in over:
                    if self._push_out(d, depth, {d}):
                        moved = True
                        break
                if moved:
                    break

            if not moved:
                self.warnings.append(
                    "Kunne ikke udjævne holdstørrelserne: ingen kæde af ønskede datoer "
                    "forbinder de for store hold med de for små."
                )
                break

    def _push_out(self, from_date: date, depth: int, visited: set[date]) -> bool:
        """
        Try to shrink ``from_date`` by one without shrinking any other date.

        Succeeds by moving someone off ``from_date`` onto a date they wished for:
        either straight onto an under-full date, or onto a full one whose own surplus
        is then pushed onward (recursively, up to ``depth`` more hops). Every move is
        applied for real and undone again on failure, so the validity checks always
        see the true state and the schedule is left exactly as it was on False.
        """
        target = self.TEAM_SIZE

        for user_id in list(self.date_to_persons[from_date]):
            # Couples were placed as a pair and are not moved individually.
            if not self.persons[user_id].can_be_switched:
                continue
            for to_date in self.persons[user_id].available_dates:
                if to_date == from_date or to_date in visited:
                    continue
                if not self.is_valid_assignment(user_id, to_date):
                    continue

                if len(self.date_to_persons[to_date]) < target:
                    self.remove_person(user_id, from_date)
                    self.assign_person(user_id, to_date)
                    return True

                if depth <= 0:
                    continue

                # Park them on the full date and push its surplus onward.
                self.remove_person(user_id, from_date)
                self.assign_person(user_id, to_date)
                if self._push_out(to_date, depth - 1, visited | {to_date}):
                    return True
                self.remove_person(user_id, to_date)
                self.assign_person(user_id, from_date)

        return False

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
            self.balance_team_sizes()
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

    def _find_missed_move(self, under: dict[date, int]) -> tuple[str, date] | None:
        """
        Name one person in the surplus who could still legally fill a short team.

        The surplus is everyone left unplaced plus everyone standing on an over-full
        date who is free to move (couples are placed as a pair and stay put). Returns
        (name, date) for the first legal move found, or None if the short teams
        genuinely can't be filled.
        """
        target = self.TEAM_SIZE
        movable: list[int] = list(self.unassigned)
        for members in self.date_to_persons.values():
            if len(members) > target:
                movable.extend(uid for uid in members if self.persons[uid].can_be_switched)

        for user_id in movable:
            person = self.persons[user_id]
            for d in under:
                if d in person.available_dates and self.is_valid_assignment(user_id, d):
                    return person.first_name, d
        return None

    def validate_result(self) -> None:
        """
        Check the final schedule, and refuse to hand over a fixable one.

        A short team sitting next to a surplus is only our failure if someone in that
        surplus could *legally* have taken the empty seat — same-house, over-50 and
        head-chef caps can make a short team genuinely unfillable, and refusing to
        generate then would just block a schedule that is as good as the sign-ups
        allow. So we look for a concrete missed move and raise only on that; a team
        that is short because too few people signed up merely warns.

        (The standalone madhold.py raises on any short-team-next-to-surplus. That
        over-fires on constrained input — e.g. a house supplying most of the cooks —
        so the check is narrowed here to a move we can actually name.)
        """
        target = self.TEAM_SIZE
        sizes = {d: len(m) for d, m in self.date_to_persons.items() if m}
        under = {d: n for d, n in sizes.items() if n < target}
        over = {d: n for d, n in sizes.items() if n > target}

        if under:
            missed = self._find_missed_move(under)
            if missed is not None:
                name, to_date = missed
                detail = ", ".join(f"{d}: {n}" for d, n in sorted(under.items()))
                parts = [f"Hold under {target} personer — {detail}."]
                if over:
                    parts.append(
                        "For store hold: " + ", ".join(f"{d}: {n}" for d, n in sorted(over.items()))
                    )
                parts.append(
                    f"Holdene kunne have været udjævnet: {name} kan lave mad {to_date}. "
                    f"Det er en fejl i holdgenereringen — prøv igen, og sig til hvis den "
                    f"bliver ved."
                )
                raise SchedulingError(" ".join(parts))

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
        # Delete existing teams across everything the admin asked for, not just
        # the trimmed list, so a dropped date can't keep a stale team.
        FoodTeam.objects.filter(date__in=self.requested_dates).delete()

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

        # Hand the dropped dates to the next cycle: cycle_planning starts the
        # next period the day after this one's last cooking date, so the cycle
        # has to record what it actually covered. Saved inside this transaction
        # so the teams and the date list can never disagree.
        if self.dropped_dates:
            self.cycle.cooking_dates = [  # ty: ignore[invalid-assignment]
                d.isoformat() for d in self.cooking_dates
            ]
            self.cycle.save(update_fields=["cooking_dates", "updated_at"])

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

            self._trim_dates_to_capacity()
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
                dropped_dates=[d.isoformat() for d in self.dropped_dates],
            )

        except SchedulingError as e:
            # A refusal, not a crash: nothing was saved (save_teams runs after
            # validate_result), so the existing teams are untouched and the admin
            # gets a message that says what to fix.
            return TeamGenerationResult(
                success=False,
                message=str(e),
                warnings=self.warnings,
            )

        except Exception as e:  # noqa: BLE001 - web action, never let it 500
            return TeamGenerationResult(
                success=False,
                message=f"Fejl under generering: {e!s}",
            )


def generate_teams_for_cycle(
    cycle: FoodTeamCycle,
    save: bool = True,
    allow_couples_without_common_dates: bool = False,
) -> TeamGenerationResult:
    """
    Convenience function to generate teams for a cycle.

    Args:
        cycle: The FoodTeamCycle to generate teams for.
        save: Whether to save the teams to the database.
        allow_couples_without_common_dates: Schedule un-pairable couples singly
            instead of refusing to generate.

    Returns:
        TeamGenerationResult with details about the generation.
    """
    generator = TeamGenerator(
        cycle, allow_couples_without_common_dates=allow_couples_without_common_dates
    )
    return generator.generate(save=save)
