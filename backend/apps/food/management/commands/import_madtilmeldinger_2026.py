"""Import all 2026 madtilmeldinger from Google Drive in one command.

Runs the individual import_madtilmeldinger command for each monthly file,
clears existing MealRegistration data on the first file, and imports
MealPreference defaults + ClosedFoodDay records from the June spreadsheet.

Usage::

    python manage.py import_madtilmeldinger_2026
    python manage.py import_madtilmeldinger_2026 --dry-run
"""

from django.core.management import call_command
from django.core.management.base import BaseCommand

# Google Drive / Google Sheets IDs for each monthly file (publicly accessible)
# Each entry: (label, drive_id, extra_flags)
_SOURCES = [
    ("Jan 2026 (weeks 2-4)", "1Kpgg2LXXwWk0c4KgbphXk4roe20mSwaZ", {}),
    ("Feb 2026 (weeks 5-8; w7=vinterferie)", "1qiSjlkjei2bxUR0kRqmobcDcrm_nzOGL", {}),
    ("Mar 2026 (weeks 9-12)", "1y5F-F89VVra2-mFKney3koiHu6XlitKb", {}),
    ("Apr 2026 (weeks 13-17; w14=Easter)", "1-KsrfvRsp8UDla_BS70zQgzbSCcKLPR1", {}),
    (
        "May 2026 (weeks 18-21; Himmelfart w20)",
        "15BSMj2kUQV82Yne0_4SH7xu6njdAJFhd",
        {"import_closed_days": True},
    ),
    (
        "Jun 2026 (weeks 22-25; Pinsedag w22)",
        "1cT7BXrmP9IG60skxjkaV2peay4RF99fl",
        {"import_preferences": True, "import_closed_days": True},
    ),
]


class Command(BaseCommand):
    help = (
        "Import all 2026 madtilmeldinger from Google Drive. "
        "Clears existing MealRegistration data first (test data safe to overwrite)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report without committing any changes.",
        )

    def handle(self, *args, dry_run: bool, **options):
        verbosity = options.get("verbosity", 1)

        for i, (label, drive_id, extra) in enumerate(_SOURCES):
            self.stdout.write(f"\n=== {label} ===")
            call_command(
                "import_madtilmeldinger",
                drive_id,
                year=2026,
                clear=(i == 0),  # clear test data only on first run
                dry_run=dry_run,
                verbosity=verbosity,
                **extra,
            )

        self.stdout.write(self.style.SUCCESS("\n=== Import 2026 complete ==="))
