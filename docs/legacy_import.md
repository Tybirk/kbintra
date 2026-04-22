# Legacy WordPress Import (kbintra.dk → KB Intra)

This document describes the data export from the old `kbintra.dk` WordPress site
and how it is imported into the new Django-based KB Intra platform.

**Source**: `kloeverbakken-export-2026-04-20-7b0cf140/` at the repo root. Produced
by the "CCI" export plugin (v1.10.4) on WordPress 6.9.4.

## Export contents

```
manifest.json                       # Row counts per file
users.json                          # 216 WP users
families.json                       # 65 Family CPT posts
apartments.json                     # 58 Apartment CPT posts
events.json                         # 203 Event CPT posts
settings.json                       # Plugin settings (meal prices, invoice config…)
buddypress_groups.json              # 62 groups + 907 meta + 1670 memberships
buddypress_xprofile.json            # 15 profile fields, 1249 data rows
bbpress_forums.json                 # 62 forums + 5247 topics + 7824 replies
meals.json                          # empty
meal_bookings.json                  # empty
meal_tickets.json                   # empty
meal_ticket_subscribers.json        # empty
media.zip                           # (also unpacked in media/)
media/attachments/YYYY/MM/*.{jpg,jpeg,png,pdf,docx,xlsx}   # 87 files total
media/cci-invoices/YYYY/*.csv       # 58 historical meal invoices
```

### Why so few media files?

The export ships only 87 attachment files, but thousands of WP post meta rows
reference attachment IDs (e.g. `"family_image": "3211"`). There is **no index
mapping attachment ID → filename** in this export, so we cannot reliably link
an ID to a file on disk. Most IDs are simply unresolvable. Treat the media
folder as opportunistic: files that happen to be present can be searched by
name heuristically, but a full-fidelity media import is out of scope.

## Schema peculiarities

### Serialised PHP in meta values

Many meta fields store PHP-serialised arrays (`a:N:{i:0;s:L:"...";…}`). Examples:

- `family_members` (family→users): `a:2:{i:0;s:1:"3";i:1;s:1:"5";}`
- `apartment_family` (apartment→families): `a:1:{i:0;s:3:"164";}`
- `event_organizer`: `a:2:{i:0;s:2:"19";i:1;s:2:"24";}`
- `_bbp_sticky_topics`, `_bbp_group_ids`, `cci_options_default_meal_days`

The import uses a tiny regex-based parser (`_parse_php_list`) that pulls string
IDs out of one-dimensional serialised lists. It does not handle nested
structures — none of the fields we care about use them.

### User ID ↔ entity resolution

WP user IDs (integers-as-strings) are used as foreign keys throughout:

- `family.meta.family_members` → WP user IDs
- `apartment.meta.apartment_family` → WP family (post) IDs
- `bbpress_forums posts[].post_author` → WP user ID
- `bbpress_forums posts[].post_parent` (replies → topics, topics → forums)
- `buddypress_groups.members[].user_id` → WP user ID
- `buddypress_xprofile.data[].user_id` → WP user ID

The import builds in-memory maps:

- `wp_user_id → User` (real Django user with email)
- `wp_user_id → Child` (for children, i.e. email-less, non-vacated users)
- `wp_family_id → House` (resolved via `apartment.apartment_family`)
- `wp_group_id → Subgroup`
- `wp_forum_id → Subgroup` (resolved via `bbpress_forums.group_forum_map` + forum `post_parent`)
- `wp_topic_id → Thread`

### Who is who in `users.json`

| `cci_vacated` | has email | Count | Mapped to |
|---|---|---|---|
| `null` | yes | 108 | `users.User` (active) |
| `null` | no | 69 | `houses.Child` (linked to house via family) |
| `"1"` | yes | 0 | — |
| `"1"` | no | 39 | `users.User` (`is_active=False`) with synthetic email `vacated+<id>@legacy.kbintra.local`, to preserve authorship on historical posts |

**Children**: identified heuristically as "no email + not vacated". They have a
`date_of_birth` and show up as `family_members` on their family's record.

**Vacated**: `cci_vacated="1"` users lose their email on the way out. We still
import them as inactive users so their historical forum posts have an attributed
author; otherwise thousands of posts would show `author=None`.

### BuddyBoss groups → forum Subgroups

62 WP groups map 1:1 to `forum.Subgroup`. Signal flags:

- Group `id=1` "Fælles" → `is_main=True`, `is_default=True`
- Group `status="hidden"` → `default_members_only=True`, `allows_members=True`
- Group with `"udvalg"` or `"udvalg"` in name (case-insensitive) → `is_committee=True`, `allows_members=True`
- Group `enable_forum="0"` (only group 25 at time of export) → still create subgroup; any topics pointing at its forum will be imported if present
- `parent_id`: WP supported subgroups; KB Intra's Subgroup has no parent field. Flattened — parent is noted in description.

Membership rows (1670) become:

- `SubgroupMembership` (only for groups where `allows_members=True`)
- `SubgroupSubscription` (for everyone listed as a group member, so they keep receiving notifications)

### bbPress → forum.Thread / forum.Post

bbPress has three post types in `bbpress_forums.posts`:

- `forum` (62) — already covered by the Subgroup mapping; only used for `forum.post_parent` lookup and `_bbp_sticky_topics` meta.
- `topic` (5247) — becomes a `Thread` **plus** an initial `Post` (WP stores the topic author's body on the topic itself, not as a first reply).
- `reply` (7824) — becomes a `Post`, with `post_parent` being the topic ID.

Sticky topics (`forum.meta._bbp_sticky_topics` — a PHP-serialised list of topic
IDs) set `Thread.is_pinned=True`.

The `group_forum_map` (`{wp_group_id: [wp_forum_id]}`, 47 entries) bridges WP
groups to bbPress forums. Some forums are orphan (no group maps to them, e.g.
`id=53 "Gruppefora"`); threads pointing at those are dropped with a warning.

Post content is HTML and usable in Tiptap as-is. No inline `<img>` tags found
in 5k+ topics and 7k+ replies — posts reference attachments by HTML link only.

### xprofile fields

Only fields useful on the new User model are consumed:

| WP field | KB Intra target |
|---|---|
| Fornavn | `first_name` (fallback when `first_name` empty on user row) |
| Efternavn | `last_name` (same fallback logic) |
| Telefon | `phone_number` |
| Fødselsdato | `birthdate` |
| Profiltekst | `bio` (truncated to 500 chars) |

Dietary / allergy info (Diæt, Allergier, Andre madhensyn) is dropped — no
corresponding model exists on the new platform and it is low-signal data.

### Events

`events.json` maps straight to `events.Event`:

- `event_title` / `post_title` → `title`
- `event_description` → `description` (HTML)
- `event_start_utc` / `event_end_utc` → `start_datetime` / `end_datetime` (UTC)
- `event_location` → `location` (free-text; see normalization below)
- `event_organizer` (PHP list of WP user IDs) → first resolved user → `created_by`
- `event_image` → skipped (see media note above)
- `event_group` (WP group ID) → `Event.subgroup` if resolvable
- `event_files`, `event_booking`, `event_registration` → skipped (no RSVP data exported)

Location free-text is messy (`'Cafeen'`, `'Caféen'`, `'Café '`, `'FH'`, `'Fælleshus'`, `'Spisesalen'`, …).
We do **not** try to resolve these to `bookings.Room` — the import leaves the
string as typed to avoid mis-mapping; an admin can clean up later.

### Apartments / Houses

58 apartments, named `"Kløverbakkevej N"` (N = 1..61 mostly odd + some even),
matching our existing `House.name` format exactly. The existing `seed_houses`
command creates 62 houses numbered 1–62. Import uses `get_or_create` on name
to stay compatible; extra apartments from export create new houses.

- `meta.husnummer` → used to synthesize address if missing
- `terms.cci_cluster_tax[0].name` ("Ydre" / "Indre") → stored in description as `Klynge: <name>`
- `apartment_family` → resolved to family post IDs, then to families

### Families

65 family records. Each family has:

- `family_members`: list of WP user IDs who live in that family
- `family_description`: free-text family bio
- `family_image`: WP attachment ID (usually unresolvable — see media note)
- `family_status`: "Owner" / "Tenant" / other

The Family entity doesn't exist in KB Intra. We fold family data into Houses:

1. Find apartment for family (reverse of `apartment_family`)
2. On the matching House: append family description to `House.description`
3. Link users from `family_members` to that house via `User.house` and children via `Child.house`

A family may span multiple apartments (e.g. "Fam. Korshøj Lykke" in apartment
164). Apartments may also list multiple families (e.g. apartment `148` →
`["3432","22412"]` where the second is a historical/previous family). In
practice only the most recent family is used to populate the description.

## Entity count cheat-sheet

| Source | Target | Approx count |
|---|---|---|
| 58 apartments | `houses.House` (get_or_create) | 58 (merged with existing 62 if already seeded) |
| 108 active + 39 vacated | `users.User` | 147 |
| 69 children | `houses.Child` | 69 |
| 62 groups | `forum.Subgroup` | 62 |
| 1670 memberships | `SubgroupMembership` + `SubgroupSubscription` | 1670 |
| 5247 topics | `forum.Thread` + 1 `Post` each | 5247 + 5247 |
| 7824 replies | `forum.Post` | 7824 |
| 203 events | `events.Event` | 203 |

## Import command

```bash
cd backend
uv run python manage.py import_legacy /path/to/kloeverbakken-export-2026-04-20-7b0cf140 [options]
```

Options:

- `--dry-run` — report counts without writing
- `--only <phases>` — comma-separated phases: `houses,users,groups,forum,events`
- `--wipe` — delete all previously-imported rows first (destructive). Otherwise
  the command is **idempotent** (safe to re-run; rows are matched by a stored
  `legacy_id` where applicable, or by natural keys like email / slug / title).

### Idempotency strategy

No `legacy_id` columns are added to production models (we don't want
permanent schema debt). Instead the command builds in-memory dedup keys:

- Users: matched on `email` (exact)
- Houses: matched on `name`
- Subgroups: matched on `slug` (derived from WP group slug)
- Threads: matched on `(subgroup, slug)` where `slug=slugify(post_title)`
- Posts: matched on `(thread, author, created_at)` (WP post_date)
- Events: matched on `(title, start_datetime)`
- Children: matched on `(house, name, birthdate)`

Re-running the command updates existing rows' mutable fields (description,
phone, etc.) but never duplicates.

### Phase order

Phases must run in this order because later phases resolve references built up
by earlier ones:

1. **houses** — apartments → Houses (stores `wp_family_id → House` map via apartments' `apartment_family`)
2. **users** — users.json + xprofile + family_members → Users & Children, sets `User.house` / `Child.house`
3. **groups** — buddypress groups → Subgroups, members → Memberships/Subscriptions (uses user map)
4. **forum** — bbPress topics & replies → Threads & Posts (uses user map + subgroup map)
5. **events** — events → Events (uses user map + subgroup map)

## Things deliberately skipped

- **Passwords**: WP phpass (`$P$B…`) and `$wp$2y$` hashes are not Django-compatible.
  Imported users get an unusable password; they go through the password-reset
  flow on first login. Email invitations are **not** sent automatically.
- **Media files for profile pictures / house pictures / event images** —
  unresolvable ID→filename mapping; see earlier note.
- **Forum `File` and `Folder` models** — WP kept attachments as separate post
  types not included here.
- **Reactions, polls, thread-read status** — no equivalent data in source.
- **Messages** — not present in export (was BuddyBoss Messages, not exported).
- **Meals / bookings / tickets** — source export is empty.
- **Plugin settings** (`settings.json`) — mostly meal prices and invoice
  config; the new app models these in code/admin UI, not as key-value settings.
- **Dietary preferences / allergies from xprofile** — no target model.

## Post-import checklist

1. Run `rebuild_search_index` to populate FTS5 with imported content:
   `uv run python manage.py rebuild_search_index`
2. Spot-check a handful of imported threads for formatting fidelity.
3. Ask an admin to tidy `Event.location` strings (many variants of "Caféen").
4. Send password-reset emails when ready to invite users (out of band).
5. Review `Subgroup.is_committee` flags — the heuristic may mis-classify some
   groups (e.g. "Formidlingsudvalget" is picked up, but "Kulturudvalget" also
   contains "udvalget" so gets the flag; "Driftsudvalget" too). This matches
   the real committees list, so should be correct for this dataset.

## Where to resume

The import command lives at:

```
backend/apps/users/management/commands/import_legacy.py
```

(placed under `users` as the entry point, even though it touches many apps —
no better home given there's no dedicated "core" app)

Helper for PHP-serialised-list parsing is inline in the same file. If more
meta fields ever need unpacking, consider moving that helper to a shared
module.
