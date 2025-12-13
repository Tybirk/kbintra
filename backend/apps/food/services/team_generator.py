"""
Food team generation service.

This module contains the algorithm for generating food teams based on user wishes.
Ported from the original food_team_script.py with adaptations for Django models.

Algorithm constraints:
- Each team has 6 members
- No two people from the same house on the same date (unless they requested to be together)
- Maximum 2 "over 50" people per team
- At least 1 head chef per team
- People who want to cook with their housemate are assigned together first
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


class TeamGenerator:
    """
    Generates food teams for a cycle based on user wishes.

    The algorithm:
    1. Load all eligible persons (not exempt) and their date wishes
    2. Assign people who want to be with their housemate first
    3. Assign remaining people based on their wishes, respecting constraints
    4. Try to resolve any unassigned people by switching
    5. Balance head chefs and over-50 people across teams
    """

    MIN_TEAM_SIZE = 6
    MAX_OVER_50_PER_TEAM = 2
    MIN_HEAD_CHEFS_PER_TEAM = 1

    def __init__(self, cycle: FoodTeamCycle):
        self.cycle = cycle
        self.cooking_dates = cycle.cooking_dates

        # Data structures for the algorithm
        self.persons: dict[int, PersonData] = {}  # user_id -> PersonData
        self.special_persons: list[int] = []  # user_ids who want to be with housemate
        self.regular_persons: list[int] = []  # other user_ids

        # Assignment tracking
        self.date_to_persons: dict[date, list[int]] = {d: [] for d in self.cooking_dates}
        self.date_to_old_count: dict[date, int] = dict.fromkeys(self.cooking_dates, 0)
        self.date_to_head_chef_count: dict[date, int] = dict.fromkeys(self.cooking_dates, 0)

        # Results
        self.unassigned: list[int] = []
        self.warnings: list[str] = []

    def load_data(self) -> None:
        """Load persons and their wishes from the database."""
        # Get all non-exempt users
        users = User.objects.filter(is_exempt_from_food_teams=False).select_related("house")

        # Get wishes for this cycle
        wishes = {w.user_id: w for w in FoodTeamWish.objects.filter(cycle=self.cycle)}

        # Build person data
        for user in users:
            house_number = ""
            if user.house:
                # Extract number from house name like "House 5"
                house_number = user.house.name.replace("House ", "")

            # Get available dates from wishes or default to all dates
            available_dates = []
            if user.id in wishes:
                wish = wishes[user.id]
                available_dates = [
                    date.fromisoformat(d)
                    for d in wish.available_dates
                    if date.fromisoformat(d) in self.cooking_dates
                ]

            # If no wishes submitted, user is available for all dates
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
                can_be_switched=not user.prefers_cooking_with_housemate,
                available_dates=available_dates,
            )
            self.persons[user.id] = person

            # Categorize
            if person.prefers_housemate:
                self.special_persons.append(user.id)
            else:
                self.regular_persons.append(user.id)

        # Sort regular persons by number of available dates (fewest first)
        self.regular_persons.sort(
            key=lambda uid: (
                len(self.persons[uid].available_dates),
                -int(self.persons[uid].is_over_50),
            )
        )

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

    def is_valid_assignment(self, user_id: int, d: date) -> bool:
        """Check if assigning a person to a date is valid."""
        person = self.persons[user_id]
        assigned = self.date_to_persons[d]

        # Check for same house (unless they want to be together)
        for other_id in assigned:
            other = self.persons[other_id]
            if person.house_id and person.house_id == other.house_id:
                return False

        # Check over-50 limit
        if person.is_over_50 and self.date_to_old_count[d] >= self.MAX_OVER_50_PER_TEAM:
            return False

        # Check head chef distribution (don't have too many on one day)
        if person.can_be_head_chef and self.date_to_head_chef_count[d] >= 3:
            return False

        return True

    def is_valid_switch(
        self, person_id: int, from_date: date, switch_id: int, switch_date: date
    ) -> bool:
        """Check if switching two people between dates is valid."""
        person = self.persons[person_id]
        switch_person = self.persons[switch_id]

        # Can't switch people who prefer to be with housemate
        if not person.can_be_switched or not switch_person.can_be_switched:
            return False

        # Check date availability
        if from_date not in switch_person.available_dates:
            return False
        if switch_date not in person.available_dates:
            return False

        # Check house conflicts after switch
        for other_id in self.date_to_persons[switch_date]:
            if other_id == switch_id:
                continue
            other = self.persons[other_id]
            if person.house_id and person.house_id == other.house_id:
                return False

        for other_id in self.date_to_persons[from_date]:
            if other_id == person_id:
                continue
            other = self.persons[other_id]
            if switch_person.house_id and switch_person.house_id == other.house_id:
                return False

        # Check over-50 balance after switch
        if person.is_over_50 and not switch_person.is_over_50:
            if self.date_to_old_count[switch_date] > 1:
                return False
        if switch_person.is_over_50 and not person.is_over_50:
            if self.date_to_old_count[from_date] > 1:
                return False

        # Check head chef balance
        if person.can_be_head_chef and not switch_person.can_be_head_chef:
            if self.date_to_head_chef_count[from_date] <= 1:
                return False
        if switch_person.can_be_head_chef and not person.can_be_head_chef:
            if self.date_to_head_chef_count[switch_date] <= 1:
                return False

        return True

    def switch_persons(
        self, person_id: int, from_date: date, switch_id: int, switch_date: date
    ) -> None:
        """Switch two people between dates."""
        self.remove_person(person_id, from_date)
        self.assign_person(person_id, switch_date)
        self.remove_person(switch_id, switch_date)
        self.assign_person(switch_id, from_date)

    def assign_special_persons(self) -> None:
        """Assign people who want to be with their housemate."""
        assigned_special = set()

        for user_id in self.special_persons:
            if user_id in assigned_special:
                continue

            person = self.persons[user_id]
            if not person.house_id:
                continue

            # Find housemate who also wants to be together
            partner_id = None
            for other_id in self.special_persons:
                if other_id == user_id or other_id in assigned_special:
                    continue
                other = self.persons[other_id]
                if other.house_id == person.house_id:
                    partner_id = other_id
                    break

            if not partner_id:
                # No partner, treat as regular person
                self.regular_persons.append(user_id)
                continue

            partner = self.persons[partner_id]

            # Find common dates
            common_dates = set(person.available_dates) & set(partner.available_dates)
            common_dates = [d for d in common_dates if d in self.cooking_dates]

            # Find a valid date for both
            assigned = False
            for d in common_dates:
                if len(self.date_to_persons[d]) < self.MIN_TEAM_SIZE - 1:
                    # Check if both can be assigned (skip house check for partners)
                    old_count = self.date_to_old_count[d]
                    old_add = int(person.is_over_50) + int(partner.is_over_50)
                    if old_count + old_add <= self.MAX_OVER_50_PER_TEAM:
                        self.assign_person(user_id, d)
                        self.assign_person(partner_id, d)
                        assigned_special.add(user_id)
                        assigned_special.add(partner_id)
                        assigned = True
                        break

            if not assigned:
                self.warnings.append(
                    f"Could not assign housemates {person.first_name} and {partner.first_name} together"
                )
                # Add them as regular persons
                self.regular_persons.append(user_id)
                self.regular_persons.append(partner_id)

    def assign_regular_persons(self) -> None:
        """Assign regular persons to dates."""
        for user_id in self.regular_persons:
            person = self.persons[user_id]
            assigned = False

            for d in person.available_dates:
                if d not in self.cooking_dates:
                    continue
                if len(self.date_to_persons[d]) < self.MIN_TEAM_SIZE:
                    if self.is_valid_assignment(user_id, d):
                        self.assign_person(user_id, d)
                        assigned = True
                        break

            if not assigned:
                self.unassigned.append(user_id)

    def resolve_unassigned(self) -> None:
        """Try to resolve unassigned persons by switching."""
        dates_needing_members = [
            d for d, members in self.date_to_persons.items() if len(members) < self.MIN_TEAM_SIZE
        ]

        still_unassigned = []

        for user_id in self.unassigned:
            person = self.persons[user_id]
            resolved = False

            for d in person.available_dates:
                if d not in self.cooking_dates:
                    continue

                # If date needs members and we can be assigned
                if d in dates_needing_members and self.is_valid_assignment(user_id, d):
                    self.assign_person(user_id, d)
                    resolved = True
                    break

                # Try switching with someone on this date
                for assigned_id in list(self.date_to_persons[d]):
                    assigned_person = self.persons[assigned_id]

                    # Find dates where assigned person could go
                    for switch_date in dates_needing_members:
                        if switch_date in assigned_person.available_dates:
                            if self.is_valid_switch(user_id, switch_date, assigned_id, d):
                                # Move assigned person to switch_date
                                self.remove_person(assigned_id, d)
                                self.assign_person(assigned_id, switch_date)
                                # Assign our person to d
                                self.assign_person(user_id, d)
                                resolved = True
                                break
                    if resolved:
                        break
                if resolved:
                    break

            if not resolved:
                still_unassigned.append(user_id)

        self.unassigned = still_unassigned

    def balance_teams(self) -> None:
        """Balance head chefs and over-50 people across teams."""
        # Balance over-50 people
        for _ in range(100):  # Max iterations
            made_change = False

            for d in self.cooking_dates:
                if self.date_to_old_count[d] > self.MAX_OVER_50_PER_TEAM:
                    # Find an old person to move
                    for person_id in self.date_to_persons[d]:
                        if not self.persons[person_id].is_over_50:
                            continue

                        # Find a date to move them to
                        for switch_date in self.persons[person_id].available_dates:
                            if switch_date == d:
                                continue
                            if self.date_to_old_count[switch_date] >= self.MAX_OVER_50_PER_TEAM:
                                continue

                            # Find someone to switch with
                            for switch_id in self.date_to_persons[switch_date]:
                                if not self.persons[switch_id].is_over_50:
                                    if self.is_valid_switch(person_id, d, switch_id, switch_date):
                                        self.switch_persons(person_id, d, switch_id, switch_date)
                                        made_change = True
                                        break
                            if made_change:
                                break
                        if made_change:
                            break
                if made_change:
                    break

            # Balance head chefs
            for d in self.cooking_dates:
                if self.date_to_head_chef_count[d] == 0:
                    # Need to get a head chef here
                    for person_id in self.date_to_persons[d]:
                        for switch_date in self.persons[person_id].available_dates:
                            if switch_date == d:
                                continue
                            if self.date_to_head_chef_count[switch_date] <= 1:
                                continue

                            for switch_id in self.date_to_persons[switch_date]:
                                if self.persons[switch_id].can_be_head_chef:
                                    if self.is_valid_switch(person_id, d, switch_id, switch_date):
                                        self.switch_persons(person_id, d, switch_id, switch_date)
                                        made_change = True
                                        break
                            if made_change:
                                break
                        if made_change:
                            break
                if made_change:
                    break

            if not made_change:
                break

    def fill_remaining_slots(self) -> None:
        """Fill remaining slots with unassigned persons (allow 7 per team if needed)."""
        for user_id in list(self.unassigned):
            person = self.persons[user_id]
            for d in person.available_dates:
                if d not in self.cooking_dates:
                    continue
                # Allow up to 7 members
                if len(self.date_to_persons[d]) < self.MIN_TEAM_SIZE + 1:
                    if self.is_valid_assignment(user_id, d):
                        self.assign_person(user_id, d)
                        self.unassigned.remove(user_id)
                        break

    def validate_result(self) -> None:
        """Validate the generated teams."""
        for d, members in self.date_to_persons.items():
            if len(members) < self.MIN_TEAM_SIZE:
                self.warnings.append(
                    f"Date {d} only has {len(members)} members (need {self.MIN_TEAM_SIZE})"
                )

            if self.date_to_head_chef_count[d] == 0:
                self.warnings.append(f"Date {d} has no head chef")

            if self.date_to_old_count[d] > self.MAX_OVER_50_PER_TEAM:
                self.warnings.append(
                    f"Date {d} has {self.date_to_old_count[d]} over-50 members (max {self.MAX_OVER_50_PER_TEAM})"
                )

            # Check for duplicate houses
            house_ids = [
                self.persons[uid].house_id for uid in members if self.persons[uid].house_id
            ]
            if len(house_ids) != len(set(house_ids)):
                self.warnings.append(f"Date {d} has multiple people from the same house")

    @transaction.atomic
    def save_teams(self) -> int:
        """Save the generated teams to the database."""
        # Delete existing teams for this cycle's dates
        FoodTeam.objects.filter(date__in=self.cooking_dates).delete()

        teams_created = 0
        for d, member_ids in self.date_to_persons.items():
            if not member_ids:
                continue

            team = FoodTeam.objects.create(
                cycle=self.cycle,
                date=d,
            )

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
            # Load data
            self.load_data()

            if not self.persons:
                return TeamGenerationResult(
                    success=False,
                    message="No eligible persons found for team generation",
                )

            # Run algorithm
            self.assign_special_persons()
            self.assign_regular_persons()
            self.resolve_unassigned()
            self.balance_teams()
            self.fill_remaining_slots()
            self.validate_result()

            # Save if requested
            teams_created = 0
            if save:
                teams_created = self.save_teams()
                self.cycle.status = CycleStatus.FINALIZED
                self.cycle.save()

            unassigned_names = [self.persons[uid].first_name for uid in self.unassigned]

            success = len(self.unassigned) == 0 and not any(
                len(m) < self.MIN_TEAM_SIZE for m in self.date_to_persons.values()
            )

            return TeamGenerationResult(
                success=success,
                message=f"Generated {teams_created} teams"
                if success
                else "Generation completed with issues",
                teams_created=teams_created,
                unassigned_persons=unassigned_names,
                warnings=self.warnings,
            )

        except Exception as e:
            return TeamGenerationResult(
                success=False,
                message=f"Error during generation: {str(e)}",
            )


def generate_teams_for_cycle(cycle: FoodTeamCycle, save: bool = True) -> TeamGenerationResult:
    """
    Convenience function to generate teams for a cycle.

    Args:
        cycle: The FoodTeamCycle to generate teams for
        save: Whether to save the teams to the database

    Returns:
        TeamGenerationResult with details about the generation
    """
    generator = TeamGenerator(cycle)
    return generator.generate(save=save)
