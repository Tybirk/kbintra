"""
Management command to seed users from the all_persons.csv file.

This creates houses and users based on the community member data,
including food team related fields.
"""

import csv
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.houses.models import House
from apps.users.models import User

# Fixed birthdate for all seeded users (can be updated later)
DEFAULT_BIRTHDATE = date(1990, 1, 1)

# Street name for house addresses
STREET_NAME = "Kløverbakkevej"


class Command(BaseCommand):
    help = "Seed users and houses from all_persons.csv"

    def add_arguments(self, parser):
        parser.add_argument(
            "--csv-path",
            type=str,
            default="/home/tybirk/projects/kbintra/old_food_teams/all_persons.csv",
            help="Path to the all_persons.csv file",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created without actually creating",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing non-superuser users before seeding",
        )

    def handle(self, *args, **options):
        csv_path = Path(options["csv_path"])
        dry_run = options["dry_run"]
        clear = options["clear"]

        if not csv_path.exists():
            self.stderr.write(self.style.ERROR(f"CSV file not found: {csv_path}"))
            return

        if clear and not dry_run:
            # Keep superusers
            deleted_count, _ = User.objects.filter(is_superuser=False).delete()
            self.stdout.write(f"Cleared {deleted_count} existing users")

        # Read CSV file
        with open(csv_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        self.stdout.write(f"Found {len(rows)} rows in CSV")

        # Group by house number
        houses_data = {}
        for row in rows:
            house_num = row["Husnummer"].strip()
            if house_num not in houses_data:
                houses_data[house_num] = []
            houses_data[house_num].append(row)

        self.stdout.write(f"Found {len(houses_data)} unique houses")

        created_houses = 0
        created_users = 0
        skipped_users = 0

        for house_num, members in houses_data.items():
            # Create or get house
            house_name = f"{STREET_NAME} {house_num}"

            if dry_run:
                self.stdout.write(f"Would create/get house: {house_name}")
                house = None
            else:
                house, created = House.objects.get_or_create(
                    name=house_name,
                    defaults={
                        "description": f"Hus nummer {house_num} på {STREET_NAME}",
                        "address": house_name,
                    },
                )
                if created:
                    created_houses += 1
                    self.stdout.write(self.style.SUCCESS(f"Created house: {house_name}"))

            # Create users for this house
            for member in members:
                name = member["Navn"].strip()
                if not name or name.lower() in ["ingen1", "ingen2"]:
                    skipped_users += 1
                    continue

                # Parse name - first word is first name, rest is last name
                name_parts = name.split()
                first_name = name_parts[0]
                last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

                # Generate email (sanitized)
                email_name = first_name.lower().replace(" ", "").replace("æ", "ae").replace("ø", "o").replace("å", "a")
                email = f"{email_name}.{house_num}@kb.local"

                # Parse food team fields
                is_exempt = member.get("Fritaget", "").strip() == "1"
                is_over_50 = member.get("Over 50", "").strip() == "1"
                can_be_head_chef = member.get("Kan være chefkok", "").strip() == "1"
                prefers_housemate = member.get("Ønsker at være med medbeboer", "").strip() == "1"
                comment = member.get("Kommentar", "").strip()

                if dry_run:
                    self.stdout.write(
                        f"  Would create user: {first_name} {last_name} ({email}) - "
                        f"exempt={is_exempt}, over50={is_over_50}, chef={can_be_head_chef}, "
                        f"with_housemate={prefers_housemate}"
                    )
                else:
                    # Check if user already exists
                    if User.objects.filter(email=email).exists():
                        # Update existing user
                        user = User.objects.get(email=email)
                        user.first_name = first_name
                        user.last_name = last_name
                        user.house = house
                        user.is_exempt_from_food_teams = is_exempt
                        user.is_over_50 = is_over_50
                        user.can_be_head_chef = can_be_head_chef
                        user.prefers_cooking_with_housemate = prefers_housemate
                        user.food_team_comment = comment
                        user.save()
                        self.stdout.write(f"  Updated user: {first_name} ({email})")
                    else:
                        user = User.objects.create_user(
                            email=email,
                            password="changeme123",  # Default password
                            first_name=first_name,
                            last_name=last_name,
                            house=house,
                            is_exempt_from_food_teams=is_exempt,
                            is_over_50=is_over_50,
                            can_be_head_chef=can_be_head_chef,
                            prefers_cooking_with_housemate=prefers_housemate,
                            food_team_comment=comment,
                        )
                        created_users += 1
                        self.stdout.write(
                            self.style.SUCCESS(f"  Created user: {first_name} ({email})")
                        )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 50))
        self.stdout.write(self.style.SUCCESS(f"Created {created_houses} houses"))
        self.stdout.write(self.style.SUCCESS(f"Created {created_users} users"))
        self.stdout.write(f"Skipped {skipped_users} invalid entries")
        if dry_run:
            self.stdout.write(self.style.WARNING("(Dry run - no changes made)"))
