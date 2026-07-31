"""
Service for fetching and parsing menus from Google Drive.

This service:
- Fetches folder contents from a public Google Drive folder
- Downloads and parses .docx files containing weekly menus
- Caches results in the database
"""

import io
import logging
import re
from dataclasses import dataclass
from datetime import date

from django.conf import settings
from django.utils import timezone
from docx import Document
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from apps.food.models import DriveMenuCache

logger = logging.getLogger(__name__)


@dataclass
class ParsedMenu:
    """Parsed menu data from a .docx file."""

    week_number: int
    monday: str
    tuesday: str
    wednesday: str
    thursday: str
    raw_content: str
    folder_id: str = ""


class DriveMenuService:
    """Service for fetching menus from Google Drive."""

    # Day name patterns in Danish - match at start of line, allow trailing content
    DAY_PATTERNS = {
        "monday": re.compile(r"^mandag\s*$", re.IGNORECASE),
        "tuesday": re.compile(r"^tirsdag\s*$", re.IGNORECASE),
        "wednesday": re.compile(r"^onsdag\s*$", re.IGNORECASE),
        "thursday": re.compile(r"^torsdag\s*$", re.IGNORECASE),
    }
    # More flexible patterns that match day names even with trailing characters
    DAY_PATTERNS_FLEXIBLE = {
        "monday": re.compile(r"^mandag\b", re.IGNORECASE),
        "tuesday": re.compile(r"^tirsdag\b", re.IGNORECASE),
        "wednesday": re.compile(r"^onsdag\b", re.IGNORECASE),
        "thursday": re.compile(r"^torsdag\b", re.IGNORECASE),
    }

    # Marks the weekly grocery/veggie order block ("Gnavegrønt til ugen 18 stk
    # agurker ...") that some cooks append after Torsdag's dish. It carries no
    # weekday header, so without a terminator it gets swallowed into the last
    # parsed day (Torsdag), polluting Thursday's menu text.
    #
    # Anchored to the start of the paragraph on purpose: cooks routinely list
    # gnavegrønt as a side dish for a single day ("Tilbehør: bulgursalat med kål
    # og kerner + gnavegrønt"), and across the real menu archive those mid-line
    # mentions outnumber the shopping block 21 to 6. Matching them would discard
    # genuine menu text, whereas every real shopping block begins its paragraph
    # with the word.
    STOP_SECTION_PATTERN = re.compile(
        r"\s*(gnavegr(ø|oe?)nt|ugens\s+gr(ø|oe?)nt|gr(ø|oe?)nt\s+til\s+ugen)\b",
        re.IGNORECASE,
    )

    # Pattern to extract week number from folder name (e.g., "Uge 2", "Uge 12")
    WEEK_FOLDER_PATTERN = re.compile(r"[Uu]ge\s*(\d+)")

    # Pattern to extract cook name and week from document header
    HEADER_PATTERN = re.compile(r"^(.+?)\s+[Uu]ge\s*(\d+)\s*$")

    def __init__(self) -> None:
        self.api_key = settings.GOOGLE_DRIVE_API_KEY
        self.folder_id = settings.GOOGLE_DRIVE_MENU_FOLDER_ID
        self.cache_hours = settings.MENU_CACHE_HOURS
        self._service = None

    @property
    def service(self):
        """Lazy-load the Google Drive service."""
        if self._service is None:
            if not self.api_key:
                raise ValueError(
                    "GOOGLE_DRIVE_API_KEY is not configured. "
                    "Please set it in your environment variables."
                )
            self._service = build("drive", "v3", developerKey=self.api_key)
        return self._service

    def get_menu_for_week(
        self, week_number: int, year: int | None = None, force_refresh: bool = False
    ) -> DriveMenuCache | None:
        """
        Get menu for a specific week, using cache if available.

        Stale-while-revalidate: if a stale cache exists, return it immediately
        and queue a background refresh. Only fetch synchronously when there's
        no cache at all (rare) or force_refresh=True (admin-triggered).

        Args:
            week_number: ISO week number (1-53)
            year: Year (defaults to current year)
            force_refresh: If True, fetch from Drive even if cache exists

        Returns:
            DriveMenuCache object or None if not found
        """
        if year is None:
            year = date.today().year

        cached = DriveMenuCache.objects.filter(week_number=week_number, year=year).first()

        if cached and not force_refresh:
            if not cached.is_stale(self.cache_hours):
                return cached
            # Stale: return immediately, refresh in background.
            from apps.food.tasks import refresh_drive_menu_week_task

            refresh_drive_menu_week_task(week_number, year)
            return cached

        # No cache, or force_refresh — fetch synchronously.
        try:
            menu, folder_id = self._fetch_menu_from_drive(week_number)
            if menu:
                return self._save_to_cache(menu, year)
            elif folder_id:
                # Folder found but no parseable menu yet — save folder_id so the link works
                self._save_folder_id(week_number, year, folder_id)
                return DriveMenuCache.objects.filter(week_number=week_number, year=year).first()
        except Exception as e:
            logger.error(f"Error fetching menu from Drive: {e}")
            # Return stale cache if available
            if cached:
                logger.warning("Returning stale cached menu due to fetch error")
                return cached

        return cached

    def get_current_week_menu(self, force_refresh: bool = False) -> DriveMenuCache | None:
        """Get menu for the current week."""
        today = date.today()
        week_number = today.isocalendar()[1]
        year = today.isocalendar()[0]
        return self.get_menu_for_week(week_number, year, force_refresh)

    def refresh_all_menus(self) -> dict[str, int]:
        """
        Refresh all available menus from Drive.

        Returns:
            Dict with counts of updated and failed menus
        """
        updated = 0
        failed = 0

        try:
            week_folders = self._list_week_folders()
            current_year = date.today().year

            for folder in week_folders:
                week_match = self.WEEK_FOLDER_PATTERN.search(folder["name"])
                if not week_match:
                    continue

                week_number = int(week_match.group(1))
                folder_id = folder["id"]

                # Always save the folder_id when we find the week's Drive folder
                self._save_folder_id(week_number, current_year, folder_id)

                try:
                    menu = self._fetch_menu_from_folder(folder_id, week_number)
                    if menu:
                        self._save_to_cache(menu, current_year)
                        updated += 1
                except Exception as e:
                    logger.error(f"Error fetching menu for {folder['name']}: {e}")
                    failed += 1

        except Exception as e:
            logger.error(f"Error listing week folders: {e}")

        return {"updated": updated, "failed": failed}

    def _list_week_folders(self) -> list[dict]:
        """List all week folders in the main menu folder."""
        try:
            results = (
                self.service.files()
                .list(
                    q=f"'{self.folder_id}' in parents and mimeType='application/vnd.google-apps.folder'",
                    fields="files(id, name)",
                    orderBy="name",
                )
                .execute()
            )
            return results.get("files", [])
        except Exception as e:
            logger.error(f"Error listing folders: {e}")
            return []

    def _fetch_menu_from_drive(self, week_number: int) -> tuple[ParsedMenu | None, str]:
        """Fetch menu for a specific week from Drive.

        Returns:
            Tuple of (parsed menu or None, folder_id or empty string)
        """
        folders = self._list_week_folders()

        for folder in folders:
            match = self.WEEK_FOLDER_PATTERN.search(folder["name"])
            if match and int(match.group(1)) == week_number:
                menu = self._fetch_menu_from_folder(folder["id"], week_number)
                return menu, folder["id"]

        logger.warning(f"No folder found for week {week_number}")
        return None, ""

    GDOC_MIME = "application/vnd.google-apps.document"
    DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    def _fetch_menu_from_folder(self, folder_id: str, week_number: int) -> ParsedMenu | None:
        """Fetch and parse menu from a specific folder.

        Supports both uploaded .docx files and native Google Docs documents.
        """
        try:
            results = (
                self.service.files()
                .list(
                    q=(
                        f"'{folder_id}' in parents and ("
                        f"mimeType='{self.DOCX_MIME}' or mimeType='{self.GDOC_MIME}')"
                    ),
                    fields="files(id, name, mimeType)",
                )
                .execute()
            )
            files = results.get("files", [])

            if not files:
                logger.warning(f"No menu document found in folder {folder_id}")
                return None

            file = files[0]
            menu = self._download_and_parse(file["id"], file["mimeType"], week_number)
            if menu:
                menu.folder_id = folder_id
            return menu

        except Exception as e:
            logger.error(f"Error fetching menu from folder {folder_id}: {e}")
            return None

    def _download_and_parse(
        self, file_id: str, mime_type: str, week_number: int
    ) -> ParsedMenu | None:
        """Download a document (uploaded .docx or native Google Doc) and parse it."""
        try:
            if mime_type == self.GDOC_MIME:
                # Export native Google Doc as docx
                request = self.service.files().export_media(fileId=file_id, mimeType=self.DOCX_MIME)
            else:
                request = self.service.files().get_media(fileId=file_id)

            file_content = io.BytesIO()
            downloader = MediaIoBaseDownload(file_content, request)

            done = False
            while not done:
                _, done = downloader.next_chunk()

            file_content.seek(0)
            return self._parse_docx(file_content, week_number, file_id)

        except Exception as e:
            logger.error(f"Error downloading/parsing file {file_id}: {e}")
            return None

    def _has_page_break(self, paragraph) -> bool:
        """Check if a paragraph contains or ends with a page break.

        Handles both explicit w:br page breaks (common in .docx) and
        section breaks encoded as w:sectPr in paragraph properties (common
        in Google Docs exported as .docx).
        """
        from docx.oxml.ns import qn

        # Check for explicit page break in runs
        for run in paragraph.runs:
            for child in run._element:
                if child.tag == qn("w:br") and child.get(qn("w:type")) == "page":
                    return True

        # Check for section break (Google Docs uses these for page breaks)
        p_pr = paragraph._element.find(qn("w:pPr"))
        if p_pr is not None:
            sect_pr = p_pr.find(qn("w:sectPr"))
            if sect_pr is not None:
                type_elem = sect_pr.find(qn("w:type"))
                # nextPage, oddPage, evenPage all start a new page
                if type_elem is None or type_elem.get(qn("w:val")) in (
                    "nextPage",
                    "oddPage",
                    "evenPage",
                ):
                    return True

        return False

    def _parse_docx(
        self, file_content: io.BytesIO, week_number: int, file_id: str = ""
    ) -> ParsedMenu:
        """Parse a .docx file and extract menu information from page 1 only."""
        doc = Document(file_content)

        # Extract text from page 1 only (the weekly overview). Detailed recipes
        # live on later pages, so we stop at the first page break.
        page1_paragraphs = []
        # A day's dish can spill onto the next page when that day's header sits
        # at the very bottom of page 1 (most often Torsdag). Remember the first
        # paragraph on the next page so we can rescue that dish below; otherwise
        # the page-break cutoff drops it and the day shows up empty.
        overflow_paragraph = ""
        page_break_seen = False
        for para in doc.paragraphs:
            text = para.text.strip()
            if self._has_page_break(para):
                page_break_seen = True
            if not text:
                continue
            if page_break_seen:
                overflow_paragraph = text
                break
            page1_paragraphs.append(text)

        raw_content = "\n".join(page1_paragraphs)

        # Initialize result
        menus = {
            "monday": "",
            "tuesday": "",
            "wednesday": "",
            "thursday": "",
        }

        # Parse day menus by splitting on weekday names
        current_day = None
        menu_lines = []
        seen_days: set[str] = set()

        for para in page1_paragraphs:
            # The weekly grocery/veggie order has no weekday header and would
            # otherwise be appended to Torsdag (the last day parsed). Close off
            # the day in progress and skip the block's lines — but keep scanning
            # rather than breaking out, so that if this ever misfires it can only
            # cost one day's text, never every day that follows.
            if self.STOP_SECTION_PATTERN.match(para):
                if current_day and menu_lines:
                    menus[current_day] = " ".join(menu_lines)
                current_day = None
                menu_lines = []
                continue

            # Check if this is a day header (try strict pattern first, then flexible)
            day_found = None
            remaining_content = None

            for day, pattern in self.DAY_PATTERNS.items():
                if pattern.match(para):
                    day_found = day
                    break

            # If strict match failed, try flexible pattern
            if not day_found:
                for day, pattern in self.DAY_PATTERNS_FLEXIBLE.items():
                    match = pattern.match(para)
                    if match:
                        day_found = day
                        # Extract content after the day name (may have newlines)
                        remaining = para[match.end() :].strip()
                        if remaining:
                            remaining_content = remaining.replace("\n", " ")
                        break

            if day_found:
                # Save whatever we've accumulated for the day in progress.
                if current_day and menu_lines:
                    menus[current_day] = " ".join(menu_lines)

                # If we've already seen this day, we've hit a repeated header
                # (some documents repeat day headers in both an overview and a
                # detailed recipe section on the same page). Keep the first
                # occurrence and skip the repeated section, but do NOT stop
                # parsing: later days — notably Torsdag — can appear *after* a
                # repeated earlier day, and breaking here silently dropped them
                # (the cause of the missing Wednesday/Thursday menu bug).
                if day_found in seen_days:
                    current_day = None
                    menu_lines = []
                    continue

                seen_days.add(day_found)
                current_day = day_found
                menu_lines = []

                # If there was content after the day name, add it
                if remaining_content:
                    menu_lines.append(remaining_content)
            elif current_day:
                # This is menu content for the current day
                # Replace newlines with spaces for cleaner output
                menu_lines.append(para.replace("\n", " "))

        # Don't forget the last day
        if current_day and menu_lines:
            menus[current_day] = " ".join(menu_lines)
        elif current_day and not menus[current_day] and overflow_paragraph:
            # The last day's header sat at the bottom of page 1 and its dish
            # spilled onto page 2. Rescue it — unless the next page just starts a
            # repeated day section (recipes), in which case it is not a dish.
            is_day_header = any(
                p.match(overflow_paragraph) for p in self.DAY_PATTERNS.values()
            ) or any(p.match(overflow_paragraph) for p in self.DAY_PATTERNS_FLEXIBLE.values())
            if not is_day_header and not self.STOP_SECTION_PATTERN.search(overflow_paragraph):
                menus[current_day] = overflow_paragraph.replace("\n", " ")

        return ParsedMenu(
            week_number=week_number,
            monday=menus["monday"],
            tuesday=menus["tuesday"],
            wednesday=menus["wednesday"],
            thursday=menus["thursday"],
            raw_content=raw_content,
        )

    def _save_folder_id(self, week_number: int, year: int, folder_id: str) -> None:
        """Persist the Drive folder ID for a week even if no menu has been parsed yet."""
        DriveMenuCache.objects.update_or_create(
            week_number=week_number,
            year=year,
            defaults={"drive_folder_id": folder_id},
        )

    def _save_to_cache(self, menu: ParsedMenu, year: int) -> DriveMenuCache:
        """Save parsed menu to cache."""
        cache_entry, _ = DriveMenuCache.objects.update_or_create(
            week_number=menu.week_number,
            year=year,
            defaults={
                "monday_menu": menu.monday,
                "tuesday_menu": menu.tuesday,
                "wednesday_menu": menu.wednesday,
                "thursday_menu": menu.thursday,
                "raw_content": menu.raw_content,
                "drive_folder_id": menu.folder_id,
                "fetched_at": timezone.now(),
            },
        )
        return cache_entry
