"""
Management command to seed forum subgroups.

Creates the standard subgroups for the KB community forum,
including committees (Udvalg) and interest groups.
"""

from django.core.management.base import BaseCommand

from apps.forum.models import Subgroup

# Main groups - appear at the very top
MAIN_GROUPS = [
    {
        "name": "Fælles",
        "description": "Generel diskussion og information for hele fællesskabet",
        "is_default": True,
    },
]

# Committees (Udvalg) - appear below main groups
COMMITTEES = [
    {
        "name": "Driftsudvalget",
        "description": "Alt om drift og vedligeholdelse af fællesområder",
    },
    {
        "name": "Madudvalget",
        "description": "Koordinering af fællesspisning og madhold",
    },
    {
        "name": "El-bil udvalget",
        "description": "Elbiler, ladning og delebilsordning",
    },
    {
        "name": "Grønt udvalg",
        "description": "Havearbejde, grønne områder og bæredygtighed",
    },
    {
        "name": "Børn- og ungeudvalg",
        "description": "Aktiviteter og arrangementer for børn og unge",
    },
    {
        "name": "Kulturudvalget",
        "description": "Kulturelle arrangementer og aktiviteter",
    },
    {
        "name": "Værkstedsudvalget",
        "description": "Fællesværksted og værktøj",
    },
    {
        "name": "Formidlingsudvalget",
        "description": "Kommunikation og formidling",
    },
]

# Regular groups and interest groups
GROUPS = [
    {
        "name": "Badmintongruppe",
        "description": "For badmintonspillere i fællesskabet",
    },
    {
        "name": "Lydgruppe",
        "description": "Lydudstyr og musik",
    },
    {
        "name": "Byt / Giv / Lån",
        "description": "Byt, giv væk eller lån ting med naboerne",
    },
    {
        "name": "Løbeklub",
        "description": "For løbere i fællesskabet",
    },
    {
        "name": "Filmklub",
        "description": "Filmvisninger og diskussion",
    },
    {
        "name": "Bogklub",
        "description": "Læsekreds og boganbefalinger",
    },
    {
        "name": "Kreativ gruppe",
        "description": "Kreative projekter og hobby",
    },
    {
        "name": "Spil og brætspil",
        "description": "Brætspil, kortspil og spilarrangementer",
    },
    {
        "name": "Yoga og motion",
        "description": "Yoga, træning og motion",
    },
    {
        "name": "IT og teknik",
        "description": "Teknisk hjælp og IT-relaterede emner",
    },
    {
        "name": "Køb og salg",
        "description": "Køb og salg mellem beboere",
    },
]


class Command(BaseCommand):
    help = "Seed forum subgroups with standard KB community groups"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be created without actually creating",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing subgroups before seeding (WARNING: deletes all forum content!)",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        clear = options["clear"]

        if clear and not dry_run:
            deleted_count, _ = Subgroup.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Cleared {deleted_count} existing subgroups"))

        created_count = 0
        updated_count = 0

        # Create main groups first (e.g., Fælles)
        self.stdout.write(self.style.MIGRATE_HEADING("Creating main groups:"))
        for group_data in MAIN_GROUPS:
            if dry_run:
                self.stdout.write(f"  Would create main group: {group_data['name']}")
            else:
                subgroup, created = Subgroup.objects.update_or_create(
                    name=group_data["name"],
                    defaults={
                        "description": group_data.get("description", ""),
                        "is_main": True,
                        "is_committee": False,
                        "is_default": group_data.get("is_default", False),
                    },
                )
                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"  Created main group: {subgroup.name}"))
                else:
                    updated_count += 1
                    self.stdout.write(f"  Updated main group: {subgroup.name}")

        # Create committees
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Creating committees (Udvalg):"))
        for committee_data in COMMITTEES:
            if dry_run:
                self.stdout.write(f"  Would create committee: {committee_data['name']}")
            else:
                subgroup, created = Subgroup.objects.update_or_create(
                    name=committee_data["name"],
                    defaults={
                        "description": committee_data.get("description", ""),
                        "is_main": False,
                        "is_committee": True,
                        "is_default": committee_data.get("is_default", False),
                    },
                )
                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"  Created committee: {subgroup.name}"))
                else:
                    updated_count += 1
                    self.stdout.write(f"  Updated committee: {subgroup.name}")

        # Create regular groups
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Creating regular groups:"))
        for group_data in GROUPS:
            if dry_run:
                self.stdout.write(f"  Would create group: {group_data['name']}")
            else:
                subgroup, created = Subgroup.objects.update_or_create(
                    name=group_data["name"],
                    defaults={
                        "description": group_data.get("description", ""),
                        "is_main": False,
                        "is_committee": False,
                        "is_default": group_data.get("is_default", False),
                    },
                )
                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"  Created group: {subgroup.name}"))
                else:
                    updated_count += 1
                    self.stdout.write(f"  Updated group: {subgroup.name}")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=" * 50))
        self.stdout.write(
            self.style.SUCCESS(f"Created {created_count} subgroups, updated {updated_count}")
        )
        if dry_run:
            self.stdout.write(self.style.WARNING("(Dry run - no changes made)"))
