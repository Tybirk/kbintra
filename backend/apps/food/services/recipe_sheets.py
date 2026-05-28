"""
Service for fetching and parsing recipe spreadsheets from Google Drive.

Each week's Drive folder (DriveMenuCache.drive_folder_id) contains ONE
spreadsheet whose worksheet tabs are named like ``Ma1, Ma2, Ti1, Ti2,
On1, On2, To1, To2`` (Ma=Mandag, Ti=Tirsdag, On=Onsdag, To=Torsdag;
trailing digit is the dish index). Each sheet's top-left cell (A1) holds
the dish name.

The parsed result is cached on the DriveMenuCache row in ``recipe_sheets``
(a list of {code, day, index, name, url} dicts) along with the spreadsheet's
Drive file id in ``recipe_file_id``.
"""

import datetime
import io
import logging
import re

from django.conf import settings
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

# Sheet tab name pattern, e.g. "Ma1", "To2" (case-insensitive)
SHEET_PATTERN = re.compile(r"^(Ma|Ti|On|To)(\d+)$", re.IGNORECASE)

# Day prefix -> weekday index (Mon=0 ... Thu=3)
DAY_PREFIX_TO_INDEX = {
    "ma": 0,
    "ti": 1,
    "on": 2,
    "to": 3,
}

GSHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def folder_url(folder_id: str) -> str:
    """Return a browser URL for a Google Drive folder."""
    return f"https://drive.google.com/drive/folders/{folder_id}"


class RecipeSheetService:
    """Service for fetching recipe spreadsheets from Google Drive."""

    def __init__(self) -> None:
        self.api_key = settings.GOOGLE_DRIVE_API_KEY
        self.folder_id = settings.GOOGLE_DRIVE_MENU_FOLDER_ID
        self._service = None

    @property
    def service(self):
        """Lazy-load the Google Drive (v3) service."""
        if self._service is None:
            if not self.api_key:
                raise ValueError(
                    "GOOGLE_DRIVE_API_KEY is not configured. "
                    "Please set it in your environment variables."
                )
            self._service = build("drive", "v3", developerKey=self.api_key)
        return self._service

    def _find_spreadsheet_in_folder(self, folder_id: str) -> tuple[str | None, str | None]:
        """Find the first spreadsheet (native Google Sheet or .xlsx) in a folder.

        Returns:
            (file_id, mime_type) or (None, None) if none found.
        """
        try:
            results = (
                self.service.files()
                .list(
                    q=(
                        f"'{folder_id}' in parents and ("
                        f"mimeType='{GSHEET_MIME}' or mimeType='{XLSX_MIME}')"
                    ),
                    fields="files(id, name, mimeType)",
                )
                .execute()
            )
            files = results.get("files", [])
            if not files:
                return None, None
            first = files[0]
            return first["id"], first["mimeType"]
        except Exception as e:
            logger.error(f"Error finding spreadsheet in folder {folder_id}: {e}")
            return None, None

    def parse_recipe_sheets(self, folder_id: str) -> list[dict]:
        """Parse all recipe sheets in the spreadsheet inside ``folder_id``.

        Returns a list of {code, day (0-3), index (int), name (str), url (str)}
        dicts, one per worksheet whose title matches the Ma/Ti/On/To<digit>
        pattern. Returns [] on any failure.
        """
        try:
            file_id, mime_type = self._find_spreadsheet_in_folder(folder_id)
            if not file_id:
                logger.warning(f"No recipe spreadsheet found in folder {folder_id}")
                return []

            if mime_type == GSHEET_MIME:
                return self._parse_native_sheet(file_id)
            return self._parse_xlsx(file_id)
        except Exception as e:
            logger.error(f"Error parsing recipe sheets in folder {folder_id}: {e}")
            return []

    def _entry_from_title(self, title: str, a1_value, url: str) -> dict | None:
        """Build a recipe entry from a sheet title, A1 value and url.

        Returns None if the title doesn't match the recipe sheet pattern.
        """
        match = SHEET_PATTERN.match(title.strip())
        if not match:
            return None
        prefix = match.group(1).lower()
        index = int(match.group(2))
        day = DAY_PREFIX_TO_INDEX[prefix]

        name = ""
        if a1_value is not None:
            name = str(a1_value).strip()
        if not name:
            name = title.strip()

        return {
            "code": title.strip(),
            "day": day,
            "index": index,
            "name": name,
            "url": url,
        }

    def _parse_native_sheet(self, file_id: str) -> list[dict]:
        """Parse a native Google Sheet via the Sheets API."""
        try:
            sheets_service = build("sheets", "v4", developerKey=self.api_key)

            # First: titles + gids of all sheets.
            meta = (
                sheets_service.spreadsheets()
                .get(
                    spreadsheetId=file_id,
                    fields="sheets.properties(sheetId,title)",
                )
                .execute()
            )
            sheets = meta.get("sheets", [])

            # Collect titles that match, mapping title -> (sheetId, index)
            matching: list[tuple[str, int]] = []
            for sheet in sheets:
                props = sheet.get("properties", {})
                title = props.get("title", "")
                sheet_id = props.get("sheetId", 0)
                if SHEET_PATTERN.match(title.strip()):
                    matching.append((title, sheet_id))

            if not matching:
                return []

            # Batch-read A1 of each matching sheet.
            ranges = [f"'{title}'!A1" for title, _ in matching]
            batch = (
                sheets_service.spreadsheets()
                .values()
                .batchGet(spreadsheetId=file_id, ranges=ranges)
                .execute()
            )
            value_ranges = batch.get("valueRanges", [])

            entries: list[dict] = []
            for (title, sheet_id), value_range in zip(matching, value_ranges, strict=False):
                values = value_range.get("values", [])
                a1_value = None
                if values and values[0]:
                    a1_value = values[0][0]
                url = f"https://docs.google.com/spreadsheets/d/{file_id}/edit#gid={sheet_id}"
                entry = self._entry_from_title(title, a1_value, url)
                if entry:
                    entries.append(entry)
            return entries
        except Exception as e:
            logger.error(f"Error parsing native Google Sheet {file_id}: {e}")
            return []

    def _parse_xlsx(self, file_id: str) -> list[dict]:
        """Parse an uploaded .xlsx spreadsheet via openpyxl."""
        try:
            import openpyxl

            # Per-sheet deep-linking isn't reliable for xlsx; use the file's
            # webViewLink for every sheet.
            url = ""
            try:
                file_meta = self.service.files().get(fileId=file_id, fields="webViewLink").execute()
                url = file_meta.get("webViewLink", "") or ""
            except Exception as e:
                logger.error(f"Error fetching webViewLink for {file_id}: {e}")

            request = self.service.files().get_media(fileId=file_id)
            file_content = io.BytesIO()
            downloader = MediaIoBaseDownload(file_content, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            file_content.seek(0)

            workbook = openpyxl.load_workbook(file_content, read_only=True)
            entries: list[dict] = []
            for ws in workbook.worksheets:
                title = ws.title
                if not SHEET_PATTERN.match(title.strip()):
                    continue
                a1_value = ws["A1"].value
                entry = self._entry_from_title(title, a1_value, url)
                if entry:
                    entries.append(entry)
            workbook.close()
            return entries
        except Exception as e:
            logger.error(f"Error parsing xlsx spreadsheet {file_id}: {e}")
            return []

    def get_recipes_for_week(
        self, week_number: int, year: int | None = None, force_refresh: bool = False
    ) -> list[dict]:
        """Get recipe sheets for a week, using/refreshing the DriveMenuCache.

        Returns a list of recipe entry dicts (possibly empty).
        """
        from apps.food.models import DriveMenuCache

        if year is None:
            year = datetime.date.today().year

        cache = DriveMenuCache.objects.filter(week_number=week_number, year=year).first()
        if cache is None:
            return []

        if cache.recipe_sheets and not force_refresh:
            return cache.recipe_sheets

        if not cache.drive_folder_id:
            return []

        file_id, _ = self._find_spreadsheet_in_folder(cache.drive_folder_id)
        parsed = self.parse_recipe_sheets(cache.drive_folder_id)

        cache.recipe_sheets = parsed
        cache.recipe_file_id = file_id or ""
        cache.save(update_fields=["recipe_sheets", "recipe_file_id"])
        return parsed

    def recipes_for_date(self, d: datetime.date) -> list[dict]:
        """Return recipe entries for a specific date, sorted by dish index."""
        iso = d.isocalendar()
        week_number = iso[1]
        year = iso[0]
        recipes = self.get_recipes_for_week(week_number, year)
        weekday = d.weekday()
        filtered = [r for r in recipes if r.get("day") == weekday]
        return sorted(filtered, key=lambda r: r.get("index", 0))
