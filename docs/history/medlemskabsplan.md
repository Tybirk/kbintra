# PRD: Group Membership and Private Threads/Files

## Problem Statement

The KB Intra forum currently has only one way for a resident to "belong" to a subgroup: by *subscribing* to it, which is a notification preference, not a statement of participation. This creates several real-world friction points:

- **Committee work has no source of truth.** When a resident wants to know who is on Grønt udvalg, Driftsudvalget, or any other committee, the app cannot tell them. There's no list of members, no "Formand," no "Kasserer," and no way to look up who to contact.
- **All forum content is broadcast.** Every thread is visible to all 90 residents, even when committee discussions touch on sensitive matters (personal applications, internal coordination, financial details). Residents who want to write privately to a committee — for example, applying to a working group, raising a personal concern, or submitting a confidential request — have no way to do so within the forum. They fall back to direct messaging individuals or sending email outside the app, which fragments communication and loses the committee's collective context.
- **Subscription-based notifications are noisy and lossy.** A committee member who happens to have unsubscribed from notifications has no special status that ensures they hear about new threads in their own committee. Conversely, a curious resident who is subscribed to "Grønt udvalg" receives notifications even though they have no decision-making role.
- **The terminology is misleading.** The current UI says users are "tilmeldt" a group, which sounds like membership, but it really only means they've opted into notifications. This conflates two distinct ideas and makes the upcoming membership feature confusing without a rename.

## Solution

Introduce a first-class concept of **group membership**, distinct from but related to subscription, and use it to power both a visible members directory and a privacy gate for sensitive threads and files.

From the user's perspective:

- **Membership replaces ambiguity.** Subgroups that benefit from membership (committees, working groups) explicitly opt in via a new "tillader medlemmer" flag. Other groups (Fælles, Løbeklub, hobby groups) stay the way they are — anyone subscribes, no membership.
- **Each group with members has a visible directory.** On a committee's page, residents see a "Medlemmer" section with avatars, names, and roles ("Formand," "Kasserer," "Medlem," or any free-text title). The directory is collapsed by default to keep the page clean, expanded with one click. Anyone can read it; only members and admins can edit it.
- **Members get added by people, not by self-service.** A non-member cannot click a button to join Grønt udvalg. Instead, an admin or an existing member adds them via a familiar user-picker (the same one used for adding participants to a direct message). This keeps committees deliberate and avoids drive-by joining.
- **Members can leave on their own.** A member can click "Forlad gruppe" at any time, with a confirmation modal. Removing themselves doesn't unsubscribe them — they keep getting notifications until they manually unsubscribe.
- **Membership implies subscription, automatically.** When you're added as a member of Driftsudvalget, you're also subscribed to it (so you hear about new threads). Leaving as a member does not auto-unsubscribe you — that's a deliberate separate action.
- **Threads and files can be marked "Kun for medlemmer."** When creating a thread (or uploading a file) in a group that allows members, the author sees a checkbox: "Kun for medlemmer." When checked, the thread becomes invisible to everyone except current members of that group. The author themselves can always see their own thread, even if they're not a member — this is the key affordance that lets a non-member resident write to a committee privately.
- **Admins are treated like ordinary residents for privacy.** A site admin (`is_staff`) does not get special bypass access to private threads. If they want to see Grønt udvalg's private threads, they have to be a member. This makes "private" actually private and prevents accidental snooping.
- **The forum overview surfaces membership prominently.** A new section, "Grupper du er medlem af," appears at the top of the forum page, ahead of "Grupper du abonnerer på." Subscribers and members see clearly what they're part of vs. what they're just following.
- **The terminology is fixed.** All forum-context strings that previously said "tilmeldt" now say "abonnerer på," reserving "medlem" exclusively for the new membership concept. The food and event sign-up flows keep their existing "tilmeldt" wording — those are literal sign-ups and unrelated.

## User Stories

### Membership concept and renaming

1. As a resident, I want the forum overview to clearly distinguish between groups I am a member of and groups I merely subscribe to, so that I understand my actual roles in the community.
2. As a resident, I want the wording in the forum to use "abonnerer på" instead of "tilmeldt," so that the language matches my mental model of "subscription."
3. As a resident, I want subscription wording ("abonnerer på") and membership wording ("medlem af") to be consistently distinct everywhere in the app, so that I never confuse the two concepts.
4. As a resident in the food sign-up flow or event RSVP flow, I want the existing "tilmeldt" wording to stay, so that nothing visually changes about flows that are unrelated to the new membership concept.

### Group configuration

5. As an admin, I want to mark a group as "tillader medlemmer" when creating it, so that I can decide whether the group has formal members or is open to all subscribers.
6. As an admin, I want existing committees (udvalg) to be automatically configured as allowing members after the feature ships, so that I don't have to manually flip a flag for each one.
7. As an admin, I want non-committee groups (Fælles, Løbeklub, etc.) to be unaffected by the new feature, so that nothing visually or behaviorally changes for them.
8. As an admin, I want to enable membership on an existing group later, so that working groups that emerge over time can adopt the feature.
9. As an admin, I want disabling membership on a group to be blocked when it contains private threads or files, so that I cannot accidentally make private content visible to everyone.
10. As an admin, when I disable membership on a group with no private content, I want all existing memberships to be cleared automatically, so that the group is in a clean state.

### Joining and leaving

11. As an admin or current member, I want to add multiple residents as members of a group at once via a multi-select user picker, so that bootstrapping a committee takes one action.
12. As an admin or current member, I want to use the same user-picker UX I already know from the messaging app, so that adding members feels consistent with the rest of the app.
13. As a member, I want to remove another member from the group, with a confirmation modal, so that I avoid accidental removals.
14. As a member, I want to leave a group I'm part of, with a confirmation modal, so that I can step down without admin intervention.
15. As a non-member, I want to see the members list of a group but have no "join" button, so that the social contract that members are *invited* is preserved.
16. As a resident who creates a new group with membership enabled, I want to be auto-enrolled as the first member, so that I don't have to add myself afterwards.
17. As an admin who enables membership on an existing group, I want to be auto-enrolled as the first member, so that the group isn't left orphaned.
18. As a new member of a group, I want to automatically be subscribed to the group's notifications, so that I hear about activity without having to also click "abonnér."
19. As a member who leaves a group, I want my subscription to remain intact, so that I can still follow along casually after stepping back from active membership.

### Roles

20. As a member or admin, I want to set or change another member's role to a free-text label, so that I can mark someone as "Formand," "Kasserer," "Næstformand," or any other position the committee uses.
21. As a member, I want autocomplete suggestions for common roles ("Medlem," "Formand," "Kasserer") so that the most-used labels are one click away, but I can still type any free text.
22. As a new member, I want my default role to be "Medlem" so that the directory is immediately useful without manual editing.
23. As a member, I want role edits to take effect immediately without a confirmation modal, so that small clerical updates feel lightweight.
24. As any resident, I want to see each member's role next to their name in the directory, so that I know who to contact for what.

### Members list UI

25. As any resident, I want to see a "Medlemmer" section just below a group's description on its page, so that the directory is the first thing I see after the group's purpose.
26. As any resident, I want the members list to be collapsed by default with overlapping avatars and a count, so that the page stays clean for groups with many members.
27. As any resident, I want to click anywhere on the collapsed members row to expand it (not just on a small chevron), so that the expand affordance is generous and forgiving.
28. As any resident, I want each member's avatar in the expanded list to link to their profile, so that I can easily look someone up.
29. As an admin or member, I want a "Tilføj medlem" button visible on the members section, so that adding members is one click away regardless of whether the list is collapsed.
30. As any resident, I want the members list to NOT appear on groups that don't allow members, so that the UI doesn't introduce a meaningless empty section on Fælles or Løbeklub.
31. As any resident, I want members sorted alphabetically by name in the directory, so that the order is predictable.
32. As an admin viewing an empty members list, I want to see the section header and a "Tilføj medlem" button anyway, so that I know membership is enabled and how to bootstrap the group.

### Forum overview

33. As a resident, I want the forum overview to show four sections in this order — "Grupper du er medlem af," "Grupper du abonnerer på," "Udvalg," "Grupper" — so that my own commitments are surfaced first.
34. As a resident, I want each group to appear in exactly one section based on a clear precedence (member > subscriber > committee > other), so that I don't see duplicates.
35. As a member, I want the "abonnér" bell on cards in the "Grupper du er medlem af" section to be hidden or disabled, with a tooltip explaining that members always receive notifications, so that I'm not confused about what the bell would do.
36. As a member, I want unread badges and "seneste tråd" previews on member-of cards just like on subscribed cards, so that the section feels like a first-class zone, not a fallback.
37. As a default subscriber to "Fælles," I want it to appear in my "Grupper du abonnerer på" section, so that the placement is consistent and I'm not surprised.

### Private threads (members-only)

38. As a member of a committee, I want to mark a thread as "Kun for medlemmer" when creating it, so that internal discussions stay internal.
39. As a non-member resident, I want to write a private thread to a committee (e.g., to apply or raise a concern), and have only the committee members see it (plus myself), so that I have a discreet channel to that group within the forum.
40. As a non-member author of a private thread, I want to retain access to my own thread and receive replies, so that the conversation works exactly like a normal thread for me.
41. As a member of a committee, I want to flip an existing thread between public and private, so that I can correct a privacy mistake after creation.
42. As an author of a thread (member or not), I want to flip my own thread between public and private, so that I have control over my own posts.
43. As a non-member, I want private threads to be completely invisible to me — not appearing in the thread list, not findable by guessing the URL, not showing up in recent activity or the dashboard — so that "private" is genuinely private.
44. As an admin who is not a member of the committee, I want to receive no special bypass access to private threads, so that "kun for medlemmer" actually means what it says.
45. As an admin, when I want to see private content, I want to add myself as a member of the relevant group first, so that access is explicit and self-aware rather than implicit.
46. As a member, I want a clear visual indicator on private threads (e.g., a crossed-out eye icon, NOT a lock icon since "lukket" already exists), so that I can tell at a glance which threads are restricted.
47. As a member viewing a private thread's detail page, I want a banner that says "Kun synlig for medlemmer af [groupname]," so that I'm reminded of the audience when posting or replying.
48. As a non-member viewing a forum group with private threads, I want the count of threads I see to reflect only what I can access, so that I don't see misleading totals.
49. As a member who replies to a private thread, I want my reply to follow the same notification rules — only members and the author get notified — so that I don't accidentally leak the discussion via push or email.
50. As a member who @mentions a non-member in a private thread, I want the mention to be silently dropped (no notification), so that I don't accidentally invite someone who has no permission to view the thread.

### Private files

51. As a member, I want to mark a file as "Kun for medlemmer" when uploading it, so that sensitive documents (financial spreadsheets, application forms, member-only PDFs) are not visible to all 90 residents.
52. As a member, I want to flip an existing file between public and private later, so that I can correct upload mistakes.
53. As an uploader who is not a member, I want my own private file to remain accessible to me, so that I can always retrieve what I uploaded.
54. As a non-member, I want private files to be completely invisible — not in file lists, not downloadable by URL guessing, not included in folder ZIP downloads — so that file privacy is enforced everywhere.
55. As any resident, I want folders themselves to remain organizational (not markable as private), so that the structure of the documents tab stays simple.
56. As a member downloading a folder as a ZIP, I want private files I have access to be included, so that bulk download still works for me.
57. As a non-member downloading a folder as a ZIP, I want private files to be silently skipped, so that I get the public files without errors.

### Search

58. As any resident, I want to search the forum and see results filtered to only what I have permission to see, so that search doesn't leak private content.
59. As an author of a private thread, I want my own private threads and posts to appear in my search results, so that I can find my own content.
60. As a member of a group, I want private threads in that group to appear in my search results, so that search remains useful within my committees.
61. As any resident, I want subgroup names themselves to remain searchable, so that finding a group by name keeps working regardless of which threads inside are private.

### Notifications about content

62. As a member of a committee, I want to receive notifications about new threads and replies in private threads in that group, so that I can participate actively.
63. As a non-member subscriber to a committee, I want to receive notifications about public threads but NOT about private threads, so that my subscription respects the privacy boundary.
64. As an author of a private thread who is no longer a member (or never was), I want to keep receiving reply notifications, so that my application/conversation reaches me.
65. As a member who was previously a participant in a private thread but has since been removed from the group, I want to stop receiving reply notifications for that thread, so that I don't get notifications for content I can no longer access.

### Notifications about membership changes

66. As a resident, I want to receive a notification when someone adds me to a group, so that I'm aware of the new responsibility/access.
67. As a resident, I want to receive a notification when someone removes me from a group, so that I understand why my forum overview suddenly looks different.
68. As a resident, I want self-actions (adding myself as group creator, leaving voluntarily) to NOT trigger notifications to myself, so that the inbox stays clean.
69. As a resident, I want to opt out of "added to group" and "removed from group" notifications via my notification preferences, so that I can tune the noise.
70. As a resident, I want role edits to be silent (no notification), so that micro-edits to titles don't spam me.

## Implementation Decisions

### Modules to be built or modified

**Backend — `forum` app:**

- New model: `SubgroupMembership` with fields `user`, `subgroup`, `role` (free-text, default "Medlem"), `created_at`. Unique constraint on `(user, subgroup)`.
- Existing model `Subgroup` gets a new boolean field `allows_members` (default `False`).
- Existing model `Thread` gets a new boolean field `members_only` (default `False`).
- Existing model `File` gets a new boolean field `members_only` (default `False`).
- New permission class `IsMemberOrAdmin` alongside the existing `IsOwnerOrAdmin`.
- New helper function for "can user see this thread" and "can user see this file" — used by views, signals, and notification tasks.
- New views for membership CRUD: add (multi-user), remove, role-edit, leave.
- Existing `SubgroupSerializer` extended with `allows_members` and an embedded `members` list (each entry has user identity + role).
- Existing `SubgroupUpdateSerializer` extended to accept `allows_members`, with validation that disabling membership is blocked when private content exists in the group.
- Existing `ThreadSerializer` and `ThreadDetailSerializer` extended with `members_only`.
- Existing `ThreadUpdateSerializer` extended to accept `members_only` (with permission check that author or any current member can flip).
- Existing `FileSerializer` and `FileUploadSerializer` extended with `members_only`.
- New endpoint for partial-update of file metadata (currently only delete exists at that route).
- Existing thread list, thread detail (by id and by slug), thread close/pin/move/delete/update, post list/create, mark-read, recent activity, and unread-count views all gain the visibility filter for private threads.
- Existing file list, file delete, file move, file download views gain the visibility filter for private files.
- Existing folder ZIP download silently skips files the requester cannot see.
- Existing thread create and post create serializers gain logic to filter notification fan-out by membership intersection. Mention-extraction continues to drop non-members from mention notifications when the parent thread is private.
- Existing seed command for forum subgroups updated to set `allows_members=True` for committees on creation.
- Data migration: when the new `allows_members` field is added, all existing `is_committee=True` subgroups are flipped to `allows_members=True`. No memberships created automatically.

**Backend — `notifications` app:**

- Two new notification types: `SUBGROUP_MEMBER_ADDED` and `SUBGROUP_MEMBER_REMOVED`.
- Two new boolean fields on the notification preferences model: `notify_subgroup_member_added` and `notify_subgroup_member_removed`, both default `True`. Per-channel triplets (in-app, email, push) follow the existing pattern.
- New tasks (or reuse of existing fan-out infrastructure) for sending added/removed notifications, respecting the new preferences. Self-actions are excluded at task input time.
- Existing thread/post/mention notification tasks gain a recipient filter that respects private-thread visibility. Filtering happens at task input time (before enqueue) so no enqueued task ever produces a 404-link notification.

**Backend — `search` app:**

- The FTS5 index continues to index everything, including private threads, posts, and files.
- The search view post-filters results: it batch-loads `members_only` for matched threads/posts/files and the requester's current memberships once per search, then drops invisible items. The subgroup-name heuristic is unaffected (group names stay public).
- The signals that index/deindex threads, posts, and files do NOT need to know about privacy — visibility is enforced at query time.

**Frontend:**

- Existing forum overview page gets a fourth section "Grupper du er medlem af" inserted at the top, with violet/grape accent and `IconUsers`. Precedence rules ensure each group appears in exactly one section.
- Existing rename of forum-context strings ("Tilmeldt" → "Abonnerer," "Grupper du er tilmeldt" → "Grupper du abonnerer på," "Tilmeld"/"Afmeld" tooltip → "Abonnér"/"Afmeld"). Toast titles updated.
- On member-of cards, the bell-toggle is hidden or disabled with a tooltip explaining members always receive notifications.
- Existing subgroup detail page gets a new "Medlemmer" section between description and tabs. Collapsed view: header + count + overlapping avatars + "Tilføj medlem" button. Expanded view: full list with inline editable role autocomplete and remove buttons.
- New (or extracted) shared component: `UserPickerModal`, multi-select with badge chips. Built by extracting the existing add-participants modal from the messaging page so both flows use the same component.
- New thread modal gains a "Kun for medlemmer" checkbox positioned just above the "Opret tråd" button (below the file picker), only rendered when the current group has `allows_members=True`. Default unchecked.
- File upload form gains the same checkbox.
- Thread cards in the list show an `IconEyeOff` indicator next to private threads.
- Thread detail page shows a banner with text "Kun synlig for medlemmer af [groupname]" for private threads.
- File rows show the same `IconEyeOff` indicator for private files.
- Members can flip thread or file privacy after creation via a control on the detail page (or context menu); confirmation language warns about the visibility change.
- New "Medlemskab" section on the notification preferences page lists the two new toggles.
- Type definitions extended for `Subgroup` (`allows_members`, `members`), `Thread` (`members_only`), `File` (`members_only`), and a new `SubgroupMember` type.

### API contract

```
PATCH  /api/forum/subgroups/<slug>/update/         (extended: + allows_members)
POST   /api/forum/subgroups/<slug>/members/        (body: {user_ids: [...]})
DELETE /api/forum/subgroups/<slug>/members/<user_id>/
PATCH  /api/forum/subgroups/<slug>/members/<user_id>/   (body: {role: "..."})
POST   /api/forum/subgroups/<slug>/leave/
PATCH  /api/forum/threads/<pk>/update/             (extended: + members_only)
PATCH  /api/forum/files/<pk>/                      (new)
```

The members list is embedded in the existing subgroup detail response — no separate `GET /members/` endpoint. Add/remove operations return the full updated members list to simplify optimistic UI updates.

### Architectural decisions

- **Membership and subscription are separate tables, but membership implies subscription.** Adding a member auto-creates a subscription if none exists. Removing a member does not auto-delete the subscription. This preserves user agency while ensuring members hear about activity.
- **Admins are not privileged for private content visibility.** The `is_staff` flag has no effect on the private-thread / private-file gate. Admins must add themselves as members to see private content. This makes "private" actually private and prevents accidental snooping.
- **Visibility for invisible content returns 404, not 403.** This prevents leaking the existence of private threads/files via error codes.
- **Folders are not markable as private.** Privacy is per-file. Folders remain purely organizational. The trade-off (no folder-level cascade) keeps the model simple and avoids confusing "private folder, public file inside" edge cases.
- **Mentions of non-members in private threads are silently dropped.** The alternative — granting per-mention visibility via a parallel access table — was rejected as too complex. If you need to reach a non-member, add them as a member first or use the messaging app.
- **Search filtering happens at query time, not index time.** Private threads, posts, and files remain in the FTS5 index. Filtering occurs in the search view via batch-loaded visibility info per request. This preserves search for members and authors of private content, at the cost of a slightly more complex search view.
- **Disabling `allows_members` on a group with private content is blocked, not auto-publicized.** The admin must first make all private threads/files public, then disable membership. This prevents accidental data leaks via configuration changes.
- **Group creators / membership-enablers are auto-enrolled as the first member.** Avoids the orphan-group problem.
- **Notification fan filtering happens at task input time** (before enqueue), so no enqueued notification task ever produces a 404-link notification.
- **No audit log for membership changes.** The community is small (~90 users) and high-trust; political fights are not anticipated. Notifications about adds/removes provide enough transparency.

### Schema changes

- New table for `SubgroupMembership` with foreign keys to user and subgroup, a free-text role field, and a created-at timestamp. Unique constraint on the (user, subgroup) pair.
- New boolean column on `Subgroup`: `allows_members`, default `False`.
- New boolean column on `Thread`: `members_only`, default `False`.
- New boolean column on `File`: `members_only`, default `False`.
- Two new notification-type enum values: `SUBGROUP_MEMBER_ADDED`, `SUBGROUP_MEMBER_REMOVED`.
- New boolean preference fields on the notification preferences model for added/removed notifications, per channel.
- One-shot data migration: existing committees flipped to `allows_members=True`. No membership records created.

### Specific interactions

- **Group creation in the forum overview** with `allows_members=True` checked: server creates the group AND a `SubgroupMembership` for the creator AND a `SubgroupSubscription` for the creator (if not already subscribed).
- **Enabling `allows_members` on an existing group** via the subgroup edit form: server creates a `SubgroupMembership` for the editor.
- **Adding members via the user picker**: server creates `SubgroupMembership` rows AND `SubgroupSubscription` rows for any new members. Returns the full updated members list. Sends added-to-group notifications to each added user except the actor.
- **Removing a member**: server deletes only the `SubgroupMembership` row, leaving the subscription. Sends a removed-from-group notification unless the actor is the removed user themselves.
- **Leaving a group**: shortcut endpoint for self-removal. No notification sent.
- **Editing a member's role**: any current member or admin can edit any member's role (including their own). No confirmation modal. No notification.
- **Creating a private thread**: server enforces that the group has `allows_members=True` (otherwise rejects or coerces `members_only=False`). Notification fan filtered to (members of group) ∪ {author}.
- **Replying to a private thread**: visibility check on the parent thread before allowing the post. Notification fan filtered the same way. Author always receives reply notifications.
- **Toggling thread privacy after creation**: only allowed if the actor is the author or a current member of the group. Confirmation dialog warns about the visibility change.
- **Creating or uploading a private file**: same constraints as private threads.
- **Searching while logged in as a non-member**: search results post-filtered to drop invisible threads/posts/files. Subgroup name matches still appear.
- **Marking-all-read**: mark-read endpoints respect visibility — they don't try to mark threads the user can't see.
- **Disabling membership on a group**: server checks for any private threads or files in the group; rejects with a 400 error if any exist. Otherwise deletes all `SubgroupMembership` rows for the group and flips the flag.

## Testing Decisions

A good test for this feature exercises **observable external behavior** through API endpoints and UI interactions. Tests should not couple to internal helpers or specific function names. They should answer questions like "if I'm a non-member and I GET this URL, do I see this thread or get a 404?" rather than "is this helper function called with these arguments?"

### Backend tests (in the `forum` app's test module, alongside existing forum tests)

Following the conventions of the existing forum tests (pytest-django fixtures, descriptive English test names, one assertion concept per test where reasonable):

**Membership CRUD:**
- Adding members as an admin succeeds and returns the updated list.
- Adding members as an existing member succeeds.
- Adding members as a random non-member returns 403.
- Adding members to a group with `allows_members=False` returns 400.
- Removing a member as an admin or member succeeds.
- Self-leave via the shortcut endpoint succeeds for the leaving user.
- Role edit by a current member succeeds.
- Role edit by a non-member returns 403.
- Adding a member auto-creates a subscription if none exists.
- Removing a member does not delete an existing subscription.
- Creating a group with `allows_members=True` auto-enrolls the creator as the first member.
- Enabling `allows_members` on an existing group auto-enrolls the editor.

**`allows_members` flag flips:**
- `false → true` succeeds and auto-enrolls the actor.
- `true → false` succeeds when no private content exists; deletes all memberships.
- `true → false` is blocked with 400 when any private threads exist in the group.
- `true → false` is blocked with 400 when any private files exist in the group.

**Private thread visibility matrix:** for each combination of (viewer is author / current member / admin-non-member / random non-member subscriber / random non-member non-subscriber) × (thread `members_only=true` or `false`), assert the expected behavior of:
- Thread list endpoint
- Thread detail by ID
- Thread detail by slug
- Mark-read endpoint
- Recent activity endpoint
- Thread management endpoints (close, pin, move, delete, update) — non-members get 404 (not 403)

**Private file visibility matrix:** similar combinations applied to:
- File list endpoint (per-folder and per-subgroup)
- File detail / download
- Folder ZIP download (private files silently skipped for non-members, included for members)

**Notification fan-out:**
- New private thread does NOT enqueue notifications to non-member subscribers.
- New private thread DOES enqueue notifications to members.
- Reply notifications are filtered to (members ∪ {thread author}).
- @mentions of non-members in private threads do NOT generate notifications.
- @mentions of members in private threads DO generate notifications.
- Membership add/remove notifications are sent on the right events.
- Self-actions (group creator auto-enroll, voluntary leave) do NOT generate self-notifications.
- Notification preferences for added/removed are respected.

**Search filtering:**
- A non-member searching for a term that matches a private thread does not see it in results.
- A member searching for the same term does see it.
- The author of a private thread (even if non-member) sees it.
- Subgroup-name match heuristic continues to work regardless of privacy.

### Frontend tests (in the existing test files for the forum overview, subgroup detail, and thread detail pages, plus the notification preferences test file)

Vitest + Testing Library, asserting on accessible queries (`getByRole`, `getByText`):

- Forum overview renders all four sections in the right order when the user is member of one group, subscribed to another, and the rest are committees/regulars.
- Forum overview text reads "Grupper du abonnerer på" (not "Grupper du er tilmeldt"); toast titles say "Abonnerer" / "Afmeldt."
- Member-of card hides or disables the bell-toggle.
- Subgroup detail page renders the members section when `allows_members=true` and does NOT render it when `false`.
- Members list is collapsed by default; clicking expands it.
- Add-member modal opens, allows multi-select, and submits.
- "Forlad gruppe" confirmation modal appears and submits.
- Privacy checkbox is shown in thread create form only when `allows_members=true`.
- Private threads display the `IconEyeOff` indicator.
- Thread detail page shows the "Kun synlig for medlemmer" banner for private threads.
- A 404 from the thread detail endpoint produces a "ikke fundet" message (the existing thread-not-found path).
- Notification preferences page renders the new "Medlemskab" section with both toggles.

### Out of scope for testing

- Visual / pixel-regression tests.
- End-to-end tests for the full add-member-then-create-private-thread flow (the existing test suite is unit/integration focused).
- Performance / load tests for the new search visibility filter (the user base is small and the filter is bounded by result count).
- Tests for the one-shot data migration logic itself.

## Out of Scope

- **Folder-level privacy.** Only individual files are markable private. The folder structure remains organizational.
- **Per-mention private-thread access grants.** Mentioning a non-member in a private thread silently drops the mention; it does not grant access.
- **Membership-related events on the calendar app, food app, or other apps.** Membership applies only to forum subgroups. Food teams and event RSVPs continue to have their own independent "membership" / "tilmelding" concepts and are not touched.
- **Audit log for membership changes.** No history table; the most recent state is the source of truth. Notifications provide transparency.
- **Membership on announcements.** Announcements remain community-wide and have no membership concept.
- **Membership-gated calendar events or files outside the forum.** Privacy applies only to forum threads and forum files.
- **Auto-population of committee memberships during the rollout migration.** Admins are responsible for manually bootstrapping each udvalg's membership after deploy. The codebase does not have a source of truth for who is currently on each committee.
- **Automated cleanup of stale notifications when a thread's privacy is flipped.** Existing notifications that link to a now-private thread will produce a 404 once for non-members. Acceptable degenerate case.
- **Garbage collection of orphaned private threads** in groups where all members have left. The thread author retains visibility; admins can re-enroll as members to gain access. No automated recovery.
- **A "request to join" flow for non-members.** Non-members cannot self-join. They are added by an admin or existing member. If they want in, they ask out-of-band.
- **Per-group default for the privacy checkbox.** The default is always unchecked (public), with no per-group override.
- **Distinguishing notifications by membership type** (added by admin vs. added by member). The notification text simply says who added you.
- **Role priority sorting** (e.g., Formand always at the top). Members are sorted alphabetically.
- **Renaming Danish strings outside the forum context.** The food and event RSVP flows keep "tilmeldt" wording.

## Further Notes

- **Phased build order, single ship.** The implementation is built in five logical phases (rename, allows_members flag, membership model + UI + notifications, private threads, private files) but ships as a single release. Each phase is a logically separable PR-sized chunk to keep code review manageable, but the user-facing rollout is one event.
- **Bootstrap responsibility.** Immediately after deploy, all 8 existing committees will have `allows_members=true` and zero members. Admins must manually go through each committee's page and use the new "Tilføj medlem" UI to populate the membership lists. Until they do, "Kun for medlemmer" threads in those committees will be visible only to their authors. A short post-deploy admin notice (perhaps in the existing announcements feed) is recommended but not implemented as part of this PRD.
- **Shared user picker.** The existing add-participants modal in the messaging app is the proven UX pattern for multi-select user selection. Extracting it into a shared component improves consistency and avoids duplicating logic. This refactor is in scope as part of the membership UI work.
- **The crossed-out-eye icon (`IconEyeOff`) was deliberately chosen over `IconLock`** because the codebase already uses lock semantics for "lukkede tråde" (closed threads). Mixing the two would be ambiguous. The eye-off icon evokes "hidden from view" rather than "locked down."
- **Performance.** The user base is small (~90 residents), committee sizes are small (typically 5–15 members), and search results are bounded (typically <50 per query). The new visibility filters and embedded members lists are well within acceptable performance characteristics for this scale. No special caching or denormalization is required.
- **Membership-implies-subscription is enforced in views, not at the database level.** This keeps the schema simple (no database trigger) and lets the rule evolve if needed. The trade-off is that any future code path that creates a `SubgroupMembership` outside the standard view flow must remember to also create a `SubgroupSubscription`. A helper function in the forum app's services module is the natural place to centralize this.
- **The 404-instead-of-403 rule for invisible content** means that some debugging will be slightly harder ("did the thread exist? did I lack permission?"). The trade-off is justified by the privacy guarantee: leaking the existence of private content via error codes would undermine the feature.
- **No special handling for the `is_default` group ("Fælles") in the new "Grupper du abonnerer på" section.** Fælles will appear in nearly every user's subscribed section, which is technically correct. Users can visually self-filter.
- **The existing Django admin** should be updated to register the new `SubgroupMembership` model (with at least filter-by-subgroup support) so admins can troubleshoot membership issues via the Django admin interface in addition to the new in-app UI. This is a small task included in the implementation but does not warrant a separate user story.
