"""
Rewrite old kbintra.dk URLs in imported forum posts and announcements.

For every <a> element whose href contains kbintra.dk:
  - /grupper/<sg>/forum/discussion/<thread>(/page/N/)? → resolve to a Thread
    by (subgroup_slug, thread_slug). If found, rewrite href to
    /forum/<sg>/traad/<thread>. Else strip the anchor wrapper, keep text.
  - /grupper/<sg>/                                     → resolve to a Subgroup.
    If found, rewrite href to /forum/<sg>. Else strip wrapper, keep text.
  - Anything else (attachment downloads, /wp-content/, /nyttige-links/,
    /vigtig-post/, /beboere/, document-folders, etc.)              → strip
    wrapper, keep the visible text.

Subgroup-slug fallback: if an exact slug match fails, try stripping a trailing
6+ digit suffix (legacy slugs like `indvendig-bolig-tips-1061029943`).

Run with --dry-run first to preview.
"""

import re

from django.core.management.base import BaseCommand

from apps.announcements.models import Announcement
from apps.forum.models import Post, Subgroup, Thread

ANCHOR_RE = re.compile(r'<a\s+([^>]*?)href="([^"]*)"([^>]*)>(.*?)</a>', re.DOTALL)
PATH_RE = re.compile(r"^https?://(?:www\.)?kbintra\.dk(/[^?#]*)")
THREAD_PATH_RE = re.compile(r"^/grupper/([^/]+)/forum/discussion/([^/]+)")
GROUP_PATH_RE = re.compile(r"^/grupper/([^/]+)/?$")
TRAILING_NUM_RE = re.compile(r"-\d{6,}$")


def resolve_subgroup(slug: str) -> Subgroup | None:
    sg = Subgroup.objects.filter(slug=slug).first()
    if sg:
        return sg
    norm = TRAILING_NUM_RE.sub("", slug)
    if norm != slug:
        return Subgroup.objects.filter(slug=norm).first()
    return None


def rewrite_href(href: str) -> str | None:
    """Return new href if recoverable, None to indicate strip-wrapper."""
    m = PATH_RE.match(href)
    if not m:
        return None
    path = m.group(1)

    tm = THREAD_PATH_RE.match(path)
    if tm:
        sg_slug, th_slug = tm.groups()
        sg = resolve_subgroup(sg_slug)
        if sg is None:
            return None
        t = Thread.objects.filter(subgroup=sg, slug=th_slug).first()
        if t is None:
            return None
        return f"/forum/{sg.slug}/traad/{t.slug}"

    gm = GROUP_PATH_RE.match(path)
    if gm:
        sg_slug = gm.group(1)
        sg = resolve_subgroup(sg_slug)
        if sg is None:
            return None
        return f"/forum/{sg.slug}"

    return None


class Stats:
    def __init__(self) -> None:
        self.scanned = 0
        self.rewritten = 0
        self.stripped = 0
        self.untouched = 0


def transform_content(content: str, stats: Stats) -> str:
    def replace(match: re.Match[str]) -> str:
        stats.scanned += 1
        pre_attrs, href, post_attrs, inner = match.groups()
        if "kbintra.dk" not in href:
            stats.untouched += 1
            return match.group(0)
        new_href = rewrite_href(href)
        if new_href is not None:
            stats.rewritten += 1
            return f'<a {pre_attrs}href="{new_href}"{post_attrs}>{inner}</a>'
        stats.stripped += 1
        return inner

    return ANCHOR_RE.sub(replace, content)


class Command(BaseCommand):
    help = "Rewrite or strip legacy kbintra.dk anchor links in posts and announcements."

    def add_arguments(self, parser: object) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without writing to the database.",
        )
        parser.add_argument(
            "--show",
            type=int,
            default=0,
            help="Show before/after for the first N affected items per model.",
        )

    def handle(self, *args: object, **options: object) -> None:
        dry_run = options["dry_run"]
        show_n = options["show"]

        for model_label, qs in (
            ("Post", Post.objects.filter(content__icontains="kbintra.dk").iterator()),
            (
                "Announcement",
                Announcement.objects.filter(content__icontains="kbintra.dk").iterator(),
            ),
        ):
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {model_label} ==="))
            stats = Stats()
            changed = 0
            shown = 0
            for obj in qs:
                new_content = transform_content(obj.content, stats)
                if new_content == obj.content:
                    continue
                changed += 1
                if shown < show_n:
                    self.stdout.write(
                        self.style.WARNING(f"\n--- {model_label} {obj.id} (changed) ---")
                    )
                    self.stdout.write(f"BEFORE: {obj.content[:600]}")
                    self.stdout.write(f"AFTER : {new_content[:600]}")
                    shown += 1
                if not dry_run:
                    obj.content = new_content
                    obj.save(update_fields=["content"])
            self.stdout.write(
                f"  scanned anchors: {stats.scanned}  "
                f"rewritten: {stats.rewritten}  "
                f"stripped: {stats.stripped}  "
                f"untouched: {stats.untouched}"
            )
            prefix = "Would change" if dry_run else "Changed"
            self.stdout.write(self.style.SUCCESS(f"  {prefix} {changed} {model_label}s."))
