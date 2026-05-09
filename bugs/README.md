# Bug handoffs — Intra fejl og mangler

This directory holds one Markdown handoff per actionable open bug from the
"Intra fejl og mangler" forum group. Each file is self-contained: paste it
into a fresh Claude session and the agent should be able to fix the bug
without re-reading the others.

## Already fixed in the investigation session

- **Bug: Link i "Links og info" virker ikke** — Tiptap Link extension now
  accepts schemeless domains and `renderHTML` prepends `https://` for bare
  domains. Also added `kb-intra.dk` to the internal-host check.
  Prod link: <https://kb-intra.dk/forum/intra-fejl-og-mangler/traad/bug-link-i-links-og-info-virker-ikke>
  Files changed: `frontend/src/components/RichTextEditor.tsx`.

## Handoff files (in suggested fix order)

1. [01-mad-frontpage-disabled-toggle.md](01-mad-frontpage-disabled-toggle.md) — Hide disabled "Spiser/Spiser ikke" on the dashboard food card after the deadline; emphasize the "Tilmeldt: …" line.
2. [02-admin-edit-others-remove.md](02-admin-edit-others-remove.md) — Remove admins' ability to edit other users' forum posts. Consolidates two threads.
3. [03-thread-firstpost-double-menu.md](03-thread-firstpost-double-menu.md) — Drop "Slet" from the post-level menu on the first post; rename "Rediger" → "Rediger besked".
4. [04-calendar-hele-dagen-overlap.md](04-calendar-hele-dagen-overlap.md) — Fix "Hele dagen" wrapping over the time text in the Schedule Day view (large-text mode).
5. [05-announcement-header-large-text-rows.md](05-announcement-header-large-text-rows.md) — Restructure the AnnouncementCard header so each element gets its own row in large-text mode. Consolidates two threads (general layout + Forside-checkbox-overflow).
6. [06-calendar-swipe-disable.md](06-calendar-swipe-disable.md) — Drop the swipe-to-change-month gesture so users can swipe to scroll the wide grid in large-text mode without accidentally changing month.

## Skipped

See [SKIPPED.md](SKIPPED.md) — six threads triaged out, with prod links and reasons.

## Conventions for the fixing agent

- Read the handoff in full, including the original thread, before changing code.
- Keep the change focused and minimal. Don't bundle adjacent refactors.
- Run the relevant project checks (see CLAUDE.md "Required Checks").
- After the fix is committed, post the suggested Danish reply on the prod thread
  (see "Reporting back" in the handoff). The user can verify the fix on prod via
  the prod link before posting.
- All user-facing text must be in Danish.
