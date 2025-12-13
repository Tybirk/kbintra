"""
Management command to create default houses (1-62).
"""

from django.core.management.base import BaseCommand

from apps.houses.models import House


class Command(BaseCommand):
    help = "Create default houses numbered 1-62"

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
            house, created = House.objects.get_or_create(
                name=str(i),
                defaults={
                    "description": f"House number {i}",
                },
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created house: {house.name}")
            else:
                self.stdout.write(f"  House already exists: {house.name}")

        self.stdout.write(
            self.style.SUCCESS(f"Done! Created {created_count} new houses.")
        )
