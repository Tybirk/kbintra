"""
Management command to create default houses (1-62).
"""

from django.core.management.base import BaseCommand

from apps.houses.models import House

STREET_NAME = "Kløverbakkevej"


class Command(BaseCommand):
    help = "Create default houses numbered 1-62 with Kløverbakkevej addresses"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Delete existing houses and recreate them",
        )

    def handle(self, *args, **options):
        if options["force"]:
            count = House.objects.all().delete()[0]
            self.stdout.write(f"Deleted {count} existing houses")

        created_count = 0
        for i in range(1, 63):
            house_name = f"{STREET_NAME} {i}"
            house, created = House.objects.get_or_create(
                name=house_name,
                defaults={
                    "description": f"Hus nummer {i} på {STREET_NAME}",
                    "address": house_name,
                },
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created house: {house.name}")
            else:
                self.stdout.write(f"  House already exists: {house.name}")

        self.stdout.write(self.style.SUCCESS(f"Done! Created {created_count} new houses."))
