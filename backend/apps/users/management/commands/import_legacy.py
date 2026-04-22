"""
Import data from the legacy kbintra.dk WordPress export.

See docs/legacy_import.md for a full description of the mapping and decisions.

Usage:
    uv run python manage.py import_legacy /path/to/kloeverbakken-export-... \\
        [--dry-run] [--only users,forum] [--wipe]
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.text import slugify

from apps.events.models import Event
from apps.forum.models import (
    Post,
    Subgroup,
    SubgroupMembership,
    SubgroupSubscription,
    Thread,
)
from apps.houses.models import Child, House
from apps.users.models import User

CPH = ZoneInfo("Europe/Copenhagen")
UTC = ZoneInfo("UTC")

PHASES = ("houses", "users", "groups", "forum", "events")
ALL_PHASES = set(PHASES)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_php_list(value: str | None) -> list[str]:
    """Pull string/int values out of a one-dimensional PHP-serialised array.

    Handles `a:2:{i:0;s:1:"3";i:1;s:1:"5";}` and `a:1:{i:0;i:1;}`.
    Returns stringified values. Good enough for WP ID lists.
    """
    if not value or not isinstance(value, str):
        return []
    # String values: s:LEN:"..."
    # Integer values: i:123;
    out: list[str] = []
    for m in re.finditer(r's:\d+:"([^"]*)"|i:(-?\d+);', value):
        out.append(m.group(1) if m.group(1) is not None else m.group(2))
    # The first int in each pair is the array index — drop every other entry.
    # Pattern: index, value, index, value, ...
    # But the regex above captures both ints and strings; indices are always
    # ints, values can be either. For our use (one-dim lists) dropping every
    # other result starting from index 0 yields the values.
    return out[1::2] if out else []


def _parse_wp_datetime(s: str | None, assume_utc: bool = False) -> datetime | None:
    """Parse `YYYY-MM-DD HH:MM:SS` strings from the export. Returns tz-aware UTC."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s or s.startswith("0000"):
        return None
    # Some date-of-birth rows look like "1987-6-14 00:00:00"
    try:
        naive = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            naive = datetime.strptime(s.split(" ")[0], "%Y-%m-%d")
        except ValueError:
            try:
                naive = datetime.strptime(s.split(" ")[0], "%Y-%-m-%-d")
            except ValueError:
                return None
    tz = UTC if assume_utc else CPH
    return naive.replace(tzinfo=tz).astimezone(UTC)


def _parse_wp_date(s: str | None):
    """Parse a `YYYY-M-D ...` string to a date object, tolerating 1-digit month/day."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip().split(" ")[0]
    if not s or s.startswith("0000"):
        return None
    for fmt in ("%Y-%m-%d", "%Y-%-m-%-d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # Manual fallback for 1-digit components
    parts = s.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        y, m, d = (int(p) for p in parts)
        try:
            return datetime(y, m, d).date()
        except ValueError:
            return None
    return None


def _set_timestamp(model_cls, pk: int, *, created_at=None, updated_at=None) -> None:
    """Bypass auto_now_add/auto_now by using an UPDATE."""
    fields: dict[str, Any] = {}
    if created_at is not None:
        fields["created_at"] = created_at
    if updated_at is not None:
        fields["updated_at"] = updated_at
    if fields:
        model_cls.objects.filter(pk=pk).update(**fields)


def _synthetic_vacated_email(wp_id: str) -> str:
    return f"vacated+{wp_id}@legacy.kbintra.local"


COMMITTEE_KEYWORDS = ("udvalg",)


def _looks_like_committee(name: str) -> bool:
    n = name.lower()
    return any(k in n for k in COMMITTEE_KEYWORDS)


def _is_child(user_row: dict) -> bool:
    """A WP "user" row represents a child when it has no email and isn't vacated."""
    return not user_row.get("user_email") and user_row.get("cci_vacated") != "1"


# ---------------------------------------------------------------------------
# The command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Import data from the legacy kbintra.dk WordPress export."

    def add_arguments(self, parser):
        parser.add_argument(
            "export_dir",
            type=str,
            help="Path to the extracted export directory.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and report counts without writing to the DB.",
        )
        parser.add_argument(
            "--only",
            type=str,
            default="",
            help=f"Comma-separated phases to run. Available: {','.join(PHASES)}.",
        )
        parser.add_argument(
            "--wipe",
            action="store_true",
            help="Destructively delete previously-imported rows before importing. "
            "WARNING: wipes ALL threads/posts/events/subgroups, not just imported ones.",
        )
        parser.add_argument(
            "--limit-forum",
            type=int,
            default=0,
            help="Debug: import only the first N topics (0 = all).",
        )

    # ---- entry ----

    def handle(self, *args, **options):
        export_dir = Path(options["export_dir"]).resolve()
        if not export_dir.is_dir():
            raise CommandError(f"Export directory not found: {export_dir}")

        only = options["only"].strip()
        phases = {p.strip() for p in only.split(",") if p.strip()} if only else ALL_PHASES
        unknown = phases - ALL_PHASES
        if unknown:
            raise CommandError(f"Unknown phase(s): {sorted(unknown)}")

        self.dry_run = options["dry_run"]
        self.wipe = options["wipe"]
        self.limit_forum = options["limit_forum"]
        self.export_dir = export_dir

        # Cross-phase lookup tables
        self.wp_user_to_user: dict[str, User] = {}
        self.wp_user_to_child: dict[str, Child] = {}
        self.wp_family_to_house: dict[str, House] = {}
        self.wp_apartment_to_house: dict[str, House] = {}
        self.wp_group_to_subgroup: dict[str, Subgroup] = {}
        self.wp_forum_to_subgroup: dict[str, Subgroup] = {}
        self.wp_topic_to_thread: dict[str, Thread] = {}

        self.stdout.write(self.style.MIGRATE_HEADING(f"Import from: {export_dir}"))
        self.stdout.write(f"Phases: {sorted(phases)}")
        if self.dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN — no writes"))
        if self.wipe and not self.dry_run:
            self._wipe()

        # Phases are ordered and build up lookup tables.
        if "houses" in phases:
            self._phase_houses()
        if "users" in phases:
            self._phase_users()
        if "groups" in phases:
            self._phase_groups()
        if "forum" in phases:
            self._phase_forum()
        if "events" in phases:
            self._phase_events()

        self.stdout.write(self.style.SUCCESS("Done."))
        self.stdout.write(
            "Hint: run `manage.py rebuild_search_index` afterwards to index forum content."
        )

    # ---- IO ----

    def _load(self, name: str):
        path = self.export_dir / name
        if not path.exists():
            raise CommandError(f"Missing file: {path}")
        with open(path, encoding="utf-8") as fp:
            return json.load(fp)

    def _ensure_user_map(self):
        """Rebuild wp_user_to_user from users.json + the DB (by email).

        Needed when a later phase runs in a separate invocation from the users phase.
        """
        if self.wp_user_to_user:
            return
        try:
            rows = self._load("users.json")
        except CommandError:
            return
        emails_to_wp: dict[str, str] = {}
        for r in rows:
            wp_id = r["ID"]
            email = (r.get("user_email") or "").strip().lower()
            if not email and r.get("cci_vacated") == "1":
                email = _synthetic_vacated_email(wp_id)
            if email:
                emails_to_wp[email] = wp_id
        for u in User.objects.filter(email__in=emails_to_wp.keys()):
            wp_id = emails_to_wp.get(u.email)
            if wp_id:
                self.wp_user_to_user[wp_id] = u

    # ---- wipe ----

    def _wipe(self):
        self.stdout.write(self.style.WARNING("Wiping all imported data…"))
        # Order matters: children first, then users (non-superuser),
        # then forum, then events, then houses.
        deleted = {
            "Post": Post.objects.all().delete()[0],
            "Thread": Thread.objects.all().delete()[0],
            "SubgroupMembership": SubgroupMembership.objects.all().delete()[0],
            "SubgroupSubscription": SubgroupSubscription.objects.all().delete()[0],
            "Subgroup": Subgroup.objects.all().delete()[0],
            "Event": Event.objects.all().delete()[0],
            "Child": Child.objects.all().delete()[0],
            "User(non-super)": User.objects.filter(is_superuser=False).delete()[0],
            "House": House.objects.all().delete()[0],
        }
        for k, v in deleted.items():
            self.stdout.write(f"  {k}: {v} deleted")

    # ---- phase: houses ----

    def _phase_houses(self):
        self.stdout.write(self.style.MIGRATE_HEADING("[1/5] Houses (apartments + families)"))
        apartments = self._load("apartments.json")
        families = self._load("families.json")

        # Build family map first so we can enrich House description with family bio.
        fam_by_id: dict[str, dict] = {f["ID"]: f for f in families}

        created = updated = 0
        for apt in apartments:
            name = apt["post_title"].strip()
            meta = apt.get("meta", {})
            cluster_terms = apt.get("terms", {}).get("cci_cluster_tax", [])
            cluster_name = cluster_terms[0]["name"] if cluster_terms else ""

            # Resolve (latest) family for this apartment
            fam_ids = _parse_php_list(meta.get("apartment_family"))
            # Last ID tends to be the most recent/active family on WP.
            fam = None
            for fid in reversed(fam_ids):
                if fid in fam_by_id:
                    fam = fam_by_id[fid]
                    break

            parts: list[str] = []
            if cluster_name:
                parts.append(f"Klynge: {cluster_name}.")
            if fam:
                fam_desc = (fam.get("meta") or {}).get("family_description", "").strip()
                if fam_desc:
                    parts.append(fam_desc)
            description = "\n\n".join(parts)

            if self.dry_run:
                self.stdout.write(
                    f"  [dry] {name} (cluster={cluster_name}, fam={fam['ID'] if fam else None})"
                )
                continue

            house, was_created = House.objects.get_or_create(
                name=name,
                defaults={"description": description, "address": name},
            )
            if not was_created:
                # Only overwrite description if existing is blank — don't stomp manual edits.
                if description and not house.description.strip():
                    house.description = description
                    house.save(update_fields=["description"])
                if not house.address:
                    house.address = name
                    house.save(update_fields=["address"])
                updated += 1
            else:
                created += 1

            self.wp_apartment_to_house[apt["ID"]] = house
            # Map ALL families (including historical) referenced by this apartment
            # to this house so family_members → users can be assigned a house.
            for fid in fam_ids:
                self.wp_family_to_house.setdefault(fid, house)

        self.stdout.write(self.style.SUCCESS(f"  houses: {created} created, {updated} updated"))

    # ---- phase: users ----

    def _phase_users(self):
        self.stdout.write(self.style.MIGRATE_HEADING("[2/5] Users, children, xprofile"))
        users = self._load("users.json")
        xprofile = self._load("buddypress_xprofile.json")
        families = self._load("families.json")

        # Ensure we have family→house mapping even if houses phase was skipped.
        if not self.wp_family_to_house:
            for _h in House.objects.all():
                # Not strictly rebuildable without apartments.json; re-read it.
                pass
            try:
                apartments = self._load("apartments.json")
                for apt in apartments:
                    name = apt["post_title"].strip()
                    house = House.objects.filter(name=name).first()
                    if not house:
                        continue
                    self.wp_apartment_to_house[apt["ID"]] = house
                    for fid in _parse_php_list((apt.get("meta") or {}).get("apartment_family")):
                        self.wp_family_to_house.setdefault(fid, house)
            except CommandError:
                pass

        # Build xprofile lookup: wp_user_id → {field_name: value}
        field_map = {f["id"]: f["name"] for f in xprofile["fields"]}
        xp_by_user: dict[str, dict[str, str]] = {}
        for row in xprofile["data"]:
            xp_by_user.setdefault(row["user_id"], {})[
                field_map.get(row["field_id"], row["field_id"])
            ] = row["value"]

        # Build WP user id → house via family membership
        user_to_house: dict[str, House] = {}
        for fam in families:
            meta = fam.get("meta") or {}
            members = _parse_php_list(meta.get("family_members"))
            # Find the apartment that references this family
            house = None
            for _apt_id, _apt_house in self.wp_apartment_to_house.items():
                pass  # intentionally empty — we already did the reverse map below
            house = self.wp_family_to_house.get(fam["ID"])
            if not house:
                continue
            for uid in members:
                # Last-write-wins; families are generally distinct, so fine.
                user_to_house.setdefault(uid, house)

        created_users = updated_users = 0
        created_children = updated_children = 0
        skipped = 0

        for row in users:
            wp_id = row["ID"]
            xp = xp_by_user.get(wp_id, {})

            first = (row.get("first_name") or xp.get("Fornavn") or "").strip()
            last = (row.get("last_name") or xp.get("Efternavn") or "").strip()
            display = (row.get("display_name") or "").strip()
            if not first and not last and display:
                # Last resort: split display name
                parts = display.split()
                first = parts[0]
                last = " ".join(parts[1:])

            house = user_to_house.get(wp_id)
            dob = _parse_wp_date(row.get("date_of_birth")) or _parse_wp_date(xp.get("Fødselsdato"))

            if _is_child(row):
                # Children → houses.Child
                if not house:
                    skipped += 1
                    continue
                name = (display or f"{first} {last}").strip()
                if not name:
                    skipped += 1
                    continue
                if self.dry_run:
                    self.stdout.write(f"  [dry child] {name} in {house.name} dob={dob}")
                    continue
                child, was_created = Child.objects.get_or_create(
                    house=house,
                    name=name,
                    birthdate=dob,
                )
                self.wp_user_to_child[wp_id] = child
                if was_created:
                    created_children += 1
                else:
                    updated_children += 1
                continue

            # Real user
            email = (row.get("user_email") or "").strip().lower()
            is_vacated = row.get("cci_vacated") == "1"
            if not email:
                if not is_vacated:
                    # No email, not vacated, not a child — unreachable given
                    # our child detection, but guard anyway.
                    skipped += 1
                    continue
                email = _synthetic_vacated_email(wp_id)

            phone = (row.get("phone") or xp.get("Telefon") or "").strip()[:20]
            bio = (xp.get("Profiltekst") or "").strip()[:500]

            if self.dry_run:
                self.stdout.write(
                    f"  [dry user] {email} ({first} {last}) house={house.name if house else '-'} vacated={is_vacated}"
                )
                continue

            user = User.objects.filter(email=email).first()
            if user is None:
                user = User(
                    email=email,
                    first_name=first,
                    last_name=last,
                    phone_number=phone,
                    birthdate=dob,
                    bio=bio,
                    house=house,
                    is_active=not is_vacated,
                )
                user.set_unusable_password()
                user.save()
                created_users += 1
            else:
                changed = False
                for attr, val in (
                    ("first_name", first),
                    ("last_name", last),
                    ("phone_number", phone),
                    ("birthdate", dob),
                    ("bio", bio),
                ):
                    if val and getattr(user, attr) != val:
                        setattr(user, attr, val)
                        changed = True
                if house and user.house_id != getattr(house, "pk", None):
                    user.house = house
                    changed = True
                # Never re-activate vacated legacy users on re-run
                if is_vacated and user.is_active:
                    user.is_active = False
                    changed = True
                if changed:
                    user.save()
                    updated_users += 1

            self.wp_user_to_user[wp_id] = user

        self.stdout.write(
            self.style.SUCCESS(
                f"  users: {created_users} created, {updated_users} updated. "
                f"children: {created_children} created, {updated_children} updated. "
                f"skipped: {skipped}"
            )
        )

    # ---- phase: groups ----

    def _phase_groups(self):
        self.stdout.write(self.style.MIGRATE_HEADING("[3/5] Subgroups + memberships"))
        bp = self._load("buddypress_groups.json")
        bbp = self._load("bbpress_forums.json")

        # Build wp_group_id → wp_forum_id map
        group_to_forum: dict[str, str] = {}
        for gid, flist in (bbp.get("group_forum_map") or {}).items():
            if flist:
                group_to_forum[str(gid)] = str(flist[0])

        created = updated = 0
        for g in bp["groups"]:
            wp_gid = str(g["id"])
            raw_name = g["name"]
            # Strip "Lukket: " prefix (indicates hidden group) from display name
            display_name = re.sub(r"^Lukket:\s*", "", raw_name).strip()
            slug = slugify(g.get("slug") or display_name) or f"gruppe-{wp_gid}"
            description = (g.get("description") or "").strip()
            is_hidden = g.get("status") == "hidden"
            is_main = wp_gid == "1"
            is_committee = _looks_like_committee(display_name)
            allows_members = is_committee or is_hidden
            is_default = is_main

            if self.dry_run:
                self.stdout.write(
                    f"  [dry] {slug}: {display_name} main={is_main} committee={is_committee} hidden={is_hidden}"
                )
                continue

            sg = Subgroup.objects.filter(slug=slug).first()
            if sg is None:
                sg = Subgroup.objects.create(
                    name=display_name,
                    slug=slug,
                    description=description,
                    is_main=is_main,
                    is_committee=is_committee,
                    allows_members=allows_members,
                    default_members_only=is_hidden,
                    is_default=is_default,
                )
                created_at = _parse_wp_datetime(g.get("date_created"))
                if created_at:
                    _set_timestamp(Subgroup, sg.pk, created_at=created_at)
                created += 1
            else:
                dirty = False
                for attr, val in (
                    ("name", display_name),
                    ("is_main", is_main),
                    ("is_committee", is_committee),
                    ("allows_members", allows_members),
                    ("default_members_only", is_hidden),
                    ("is_default", is_default),
                ):
                    if getattr(sg, attr) != val:
                        setattr(sg, attr, val)
                        dirty = True
                if description and not sg.description.strip():
                    sg.description = description
                    dirty = True
                if dirty:
                    sg.save()
                    updated += 1

            self.wp_group_to_subgroup[wp_gid] = sg
            if wp_gid in group_to_forum:
                self.wp_forum_to_subgroup[group_to_forum[wp_gid]] = sg

        # Memberships & subscriptions
        self._ensure_user_map()
        mem_created = sub_created = 0
        for m in bp["members"]:
            if m.get("is_banned") == "1" or m.get("is_confirmed") != "1":
                continue
            wp_uid = str(m["user_id"])
            wp_gid = str(m["group_id"])
            user = self.wp_user_to_user.get(wp_uid)
            sg = self.wp_group_to_subgroup.get(wp_gid)
            if not user or not sg:
                continue

            if self.dry_run:
                continue

            if sg.allows_members:
                _, created_m = SubgroupMembership.objects.get_or_create(user=user, subgroup=sg)
                if created_m:
                    mem_created += 1
            # Always subscribe so they keep getting notifications
            _, created_s = SubgroupSubscription.objects.get_or_create(user=user, subgroup=sg)
            if created_s:
                sub_created += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"  subgroups: {created} created, {updated} updated. "
                f"memberships: {mem_created} created, subscriptions: {sub_created} created"
            )
        )

    # ---- phase: forum ----

    def _phase_forum(self):
        self.stdout.write(self.style.MIGRATE_HEADING("[4/5] Forum threads + posts"))
        bbp = self._load("bbpress_forums.json")
        posts = bbp["posts"]

        # Rebuild wp_group_to_subgroup from DB if running forum phase alone
        if not self.wp_group_to_subgroup:
            bp = self._load("buddypress_groups.json")
            for g in bp["groups"]:
                slug = slugify(g.get("slug") or g["name"])
                sg = Subgroup.objects.filter(slug=slug).first()
                if sg:
                    self.wp_group_to_subgroup[str(g["id"])] = sg
        # Rebuild wp_forum_to_subgroup from the map
        if not self.wp_forum_to_subgroup:
            for gid, flist in (bbp.get("group_forum_map") or {}).items():
                if flist:
                    sg = self.wp_group_to_subgroup.get(str(gid))
                    if sg:
                        self.wp_forum_to_subgroup[str(flist[0])] = sg

        # Fallback: the group_forum_map misses ~15 forums on this dataset.
        # Match unmapped forum posts to subgroups by slugified title, then by
        # group slug (removing the "Lukket: " prefix). Catches ~13 of 15 more.
        bp = self._load("buddypress_groups.json")
        group_slug_to_sg = {
            slugify(g.get("slug") or ""): self.wp_group_to_subgroup.get(str(g["id"]))
            for g in bp["groups"]
            if self.wp_group_to_subgroup.get(str(g["id"]))
        }
        for p in posts:
            if p.get("post_type") != "forum":
                continue
            fid = str(p["ID"])
            if fid in self.wp_forum_to_subgroup:
                continue
            # Try: slugified forum title directly
            title = (p.get("post_title") or "").strip()
            title_slug = slugify(title, allow_unicode=True)
            sg = (
                group_slug_to_sg.get(title_slug)
                or group_slug_to_sg.get(slugify(title))
                or Subgroup.objects.filter(slug=title_slug).first()
                or Subgroup.objects.filter(slug=slugify(title)).first()
            )
            if sg:
                self.wp_forum_to_subgroup[fid] = sg

        # Build user map if needed (ID → User) from DB
        self._ensure_user_map()
        if not self.wp_user_to_user:
            self.stdout.write(
                self.style.WARNING(
                    "  wp_user_to_user is empty — posts will import with author=None. "
                    "Run the `users` phase first for authorship."
                )
            )

        # Collect sticky topic IDs per forum from the `forum` post meta
        sticky_by_forum: dict[str, set[str]] = {}
        forums_by_id: dict[str, dict] = {}
        for p in posts:
            if p.get("post_type") == "forum":
                forums_by_id[p["ID"]] = p
                sticky = _parse_php_list((p.get("meta") or {}).get("_bbp_sticky_topics"))
                sticky_by_forum[p["ID"]] = set(sticky)

        topics = [p for p in posts if p.get("post_type") == "topic"]
        replies = [p for p in posts if p.get("post_type") == "reply"]

        if self.limit_forum:
            topic_ids = {t["ID"] for t in topics[: self.limit_forum]}
            topics = topics[: self.limit_forum]
            replies = [r for r in replies if r.get("post_parent") in topic_ids]

        # Topics → Threads + first Post
        threads_created = 0
        first_posts_created = 0
        skipped_topics = 0

        for t in topics:
            wp_forum_id = t.get("post_parent") or (t.get("meta") or {}).get("_bbp_forum_id")
            sg = self.wp_forum_to_subgroup.get(str(wp_forum_id))
            if not sg:
                skipped_topics += 1
                continue
            title = (t.get("post_title") or "").strip()[:200] or "(uden titel)"
            wp_author = str(t.get("post_author") or "")
            author = self.wp_user_to_user.get(wp_author)
            created_at = _parse_wp_datetime(t.get("post_date")) or timezone.now()
            is_pinned = t["ID"] in sticky_by_forum.get(str(wp_forum_id), set())
            is_closed = t.get("post_status") == "closed"

            if self.dry_run:
                continue

            # Idempotency: match on (subgroup, title, author, created_at) —
            # a WP topic is uniquely identifiable by this tuple. Slug alone
            # isn't enough because identical titles (e.g. 91x "Rester") get
            # suffixed slugs and a re-run would add more copies.
            existing_q = Thread.objects.filter(
                subgroup=sg,
                title=title,
                author=author,
                created_at=created_at,
            )
            existing = existing_q.first()
            if existing is not None:
                thread = existing
            else:
                base = slugify(title, allow_unicode=True) or "traad"
                slug = base
                n = 2
                while Thread.objects.filter(subgroup=sg, slug=slug).exists():
                    slug = f"{base}-{n}"
                    n += 1
                thread = Thread.objects.create(
                    subgroup=sg,
                    title=title,
                    slug=slug,
                    author=author,
                    is_pinned=is_pinned,
                    is_closed=is_closed,
                )
                _set_timestamp(Thread, thread.pk, created_at=created_at, updated_at=created_at)
                threads_created += 1

            self.wp_topic_to_thread[t["ID"]] = thread

            # First post from topic body
            body = (t.get("post_content") or "").strip()
            if body:
                first = Post.objects.filter(
                    thread=thread, author=author, created_at=created_at
                ).first()
                if first is None:
                    post = Post.objects.create(thread=thread, author=author, content=body)
                    _set_timestamp(Post, post.pk, created_at=created_at, updated_at=created_at)
                    first_posts_created += 1

        # Replies → Posts
        reply_created = 0
        skipped_replies = 0
        for r in replies:
            topic_id = r.get("post_parent")
            thread = self.wp_topic_to_thread.get(topic_id)
            if not thread:
                skipped_replies += 1
                continue
            wp_author = str(r.get("post_author") or "")
            author = self.wp_user_to_user.get(wp_author)
            body = (r.get("post_content") or "").strip()
            if not body:
                continue
            created_at = _parse_wp_datetime(r.get("post_date")) or timezone.now()

            if self.dry_run:
                continue

            existing = Post.objects.filter(
                thread=thread, author=author, created_at=created_at
            ).first()
            if existing is not None:
                continue
            post = Post.objects.create(thread=thread, author=author, content=body)
            _set_timestamp(Post, post.pk, created_at=created_at, updated_at=created_at)
            reply_created += 1

        # Align Thread.updated_at with the last post so list ordering
        # ("pinned first, then most recent activity") matches reality.
        # Posts were inserted directly via ORM without bumping the parent
        # thread (unlike the live PostListCreateView.perform_create path).
        if not self.dry_run and self.wp_topic_to_thread:
            from django.db.models import Max

            thread_ids = [t.pk for t in self.wp_topic_to_thread.values()]
            for row in (
                Thread.objects.filter(pk__in=thread_ids)
                .annotate(last_post_at=Max("posts__created_at"))
                .values("pk", "last_post_at")
            ):
                if row["last_post_at"]:
                    Thread.objects.filter(pk=row["pk"]).update(updated_at=row["last_post_at"])

        # Update Subgroup.last_activity_at from max thread.updated_at
        if not self.dry_run:
            for sg in self.wp_group_to_subgroup.values():
                last = (
                    Thread.objects.filter(subgroup=sg)
                    .order_by("-updated_at")
                    .values_list("updated_at", flat=True)
                    .first()
                )
                if last:
                    Subgroup.objects.filter(pk=sg.pk).update(last_activity_at=last)

        self.stdout.write(
            self.style.SUCCESS(
                f"  threads: {threads_created} created (skipped {skipped_topics}). "
                f"first posts: {first_posts_created}. "
                f"replies: {reply_created} created (skipped {skipped_replies})."
            )
        )

    # ---- phase: events ----

    def _phase_events(self):
        self.stdout.write(self.style.MIGRATE_HEADING("[5/5] Events"))
        events = self._load("events.json")
        self._ensure_user_map()

        # Ensure we can resolve WP group IDs to subgroups, even if groups phase skipped.
        if not self.wp_group_to_subgroup:
            bp = self._load("buddypress_groups.json")
            for g in bp["groups"]:
                slug = slugify(g.get("slug") or g["name"])
                sg = Subgroup.objects.filter(slug=slug).first()
                if sg:
                    self.wp_group_to_subgroup[str(g["id"])] = sg

        # Resolve a default admin as fallback creator (must be a real user)
        fallback = User.objects.filter(is_superuser=True).first() or User.objects.first()
        if fallback is None and not self.dry_run:
            self.stdout.write(self.style.ERROR("  no users in DB; skipping events phase"))
            return

        created = skipped = 0
        for ev in events:
            meta = ev.get("meta") or {}
            title = (meta.get("event_title") or ev.get("post_title") or "").strip()[:255]
            if not title:
                skipped += 1
                continue
            start = _parse_wp_datetime(
                meta.get("event_start_utc"), assume_utc=True
            ) or _parse_wp_datetime(meta.get("event_start"))
            end = (
                _parse_wp_datetime(meta.get("event_end_utc"), assume_utc=True)
                or _parse_wp_datetime(meta.get("event_end"))
                or start
            )
            if not start:
                skipped += 1
                continue
            description = unescape(meta.get("event_description") or "").strip()
            location = (meta.get("event_location") or "").strip()[:255]

            organizers = _parse_php_list(meta.get("event_organizer"))
            creator = None
            for uid in organizers:
                if uid in self.wp_user_to_user:
                    creator = self.wp_user_to_user[uid]
                    break
            if creator is None:
                creator = fallback

            subgroup = None
            group_id = meta.get("event_group")
            if group_id:
                subgroup = self.wp_group_to_subgroup.get(str(group_id))

            if self.dry_run:
                self.stdout.write(f"  [dry] {start} {title}")
                continue

            existing = Event.objects.filter(title=title, start_datetime=start).first()
            if existing is not None:
                continue
            event = Event.objects.create(
                title=title,
                description=description,
                start_datetime=start,
                end_datetime=end,
                location=location,
                created_by=creator,
                subgroup=subgroup,
                visibility=Event.Visibility.COMMUNITY,
            )
            post_date = _parse_wp_datetime(ev.get("post_date"))
            if post_date:
                _set_timestamp(Event, event.pk, created_at=post_date, updated_at=post_date)
            created += 1

        self.stdout.write(self.style.SUCCESS(f"  events: {created} created (skipped {skipped})"))
