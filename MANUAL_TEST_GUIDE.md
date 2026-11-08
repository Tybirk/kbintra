# KB Intra - Manual Test Guide

## Overview

This document describes all features in KB Intra and provides a structured testing procedure. The app serves ~90 users in a co-living community with features for communication, food coordination, and community management.

**Test URL:** http://localhost:5173 (dev) or production URL
**Test requires:** At least 2 user accounts, 1 staff/admin account

---

## Feature Inventory

### 1. Authentication & Account Management
### 2. User Profiles & Resident Directory
### 3. Forum (Discussion System)
### 4. Announcements
### 5. Food Management (Registrations, Tickets, Teams)
### 6. Calendar & Events
### 7. Room Bookings
### 8. Direct Messaging
### 9. Notifications
### 10. Global Search
### 11. Useful Links
### 12. Grafisk overblik (Organisation overview)

---

## Section 1: Authentication & Account Management

### Features
- Email-based login (no username)
- JWT access + refresh tokens (1h / 7 days with rotation)
- Invitation-only registration (admin creates invite link)
- Password reset via email token
- Email change via verification link
- Profile picture upload
- Phone, birthday, bio fields
- Light/Dark/Auto theme setting

### Test Cases

#### 1.1 Login
- [ ] Log in with correct email + password → redirected to dashboard
- [ ] Log in with wrong password → error message shown
- [ ] Log in with non-existent email → error message shown
- [ ] Session persists after page refresh (access token auto-refreshes)
- [ ] Logout → redirected to login page, all tokens cleared

#### 1.2 Invitation & Registration
- [ ] Admin creates invitation → receives link with token
- [ ] Open invitation link → registration form shows correct email pre-filled
- [ ] Register with valid invitation → account created, redirected to app
- [ ] Try to reuse same invitation link → error (token used)
- [ ] Register with mismatched passwords → validation error
- [ ] Try to register without invitation → no path to register (no open registration)

#### 1.3 Password Reset
- [ ] Click "Forgot Password" → enter email → confirmation shown
- [ ] Reset link works within 1 hour → new password set, can log in
- [ ] Reset link fails after 1 hour → error
- [ ] Reset link can only be used once → second attempt fails

#### 1.4 Profile Editing
- [ ] Upload profile picture (valid image, under 5MB) → avatar updated everywhere
- [ ] Try to upload non-image file → rejected
- [ ] Try to upload image over 5MB → rejected
- [ ] Change first/last name → updates in header, directory, posts
- [ ] Add phone number → visible on profile and in directory
- [ ] Set birthday → shows in upcoming birthdays widget on dashboard
- [ ] Add bio (up to 500 chars) → displayed on profile page
- [ ] Set theme to Dark/Light/Auto → UI changes accordingly

#### 1.5 Email Change
- [ ] Request email change → verification email sent to new address
- [ ] Confirm via link in email → email updated, can log in with new email
- [ ] Old email no longer works after confirmation

#### 1.6 Password Change
- [ ] Change password with correct current password → success
- [ ] Change password with wrong current password → error
- [ ] Mismatched new passwords → validation error

---

## Section 2: User Profiles & Resident Directory

### Features
- House list with all residents and children
- Live search across house names, resident names, children names
- Per-house detail: address, description, cars, children
- Per-user profile with contact info
- Initiate direct message from another user's profile
- House members can edit their house (description, picture, children, cars)

### Test Cases

#### 2.1 Directory
- [ ] Directory loads and shows all houses
- [ ] Search by resident name → filters to matching houses
- [ ] Search by house name → filters correctly
- [ ] Search by child name → filters correctly
- [ ] Click house card → navigates to house detail

#### 2.2 House Detail
- [ ] House picture, name, address shown
- [ ] Residents listed with avatars
- [ ] Click resident name/avatar → navigates to profile page
- [ ] Children shown with age
- [ ] Cars listed with license plate and electric badge

#### 2.3 House Edit (own house)
- [ ] Upload new house picture
- [ ] Edit house description (up to 1000 chars) and save
- [ ] Add child with name and birthdate → appears in house detail and directory
- [ ] Edit child → changes saved
- [ ] Delete child → confirmation dialog, then removed
- [ ] Add car with license plate and electric flag → appears in house detail
- [ ] Edit car → changes saved
- [ ] Delete car → confirmation dialog, then removed
- [ ] Car shows in global search by license plate

#### 2.4 User Profile
- [ ] Own profile shows all fields (name, email, phone, bio, birthday)
- [ ] Other user's profile shows "Send message" button
- [ ] "Send message" → creates conversation and navigates to messages
- [ ] House badge on profile → navigates to that house detail

---

## Section 3: Forum

### Features
- Subgroups (categories) with subscribe/unsubscribe
- Threads within subgroups (pinnable, closeable)
- Posts with rich text (HTML via Tiptap), attachments
- 6 emoji reactions per post
- Polls (single/multi-choice, optional anonymous)
- File storage with nested folders
- @mentions of users
- Unread status tracking per thread per user
- Mark all read (per subgroup or globally)
- Draft auto-save for threads and posts

### Test Cases

#### 3.1 Subgroups
- [ ] Forum page lists all subgroups
- [ ] Subscribed subgroups show subscribed indicator
- [ ] Unsubscribe from subgroup → no longer in subscriptions
- [ ] Re-subscribe → works
- [ ] Unread thread count badge shown for subscribed subgroups with unread
- [ ] "Mark all as read" button clears all unread badges

#### 3.2 Threads
- [ ] Create thread: title + rich text content → appears in subgroup
- [ ] Thread shows as unread for other users
- [ ] Open thread → marked as read, unread badge cleared
- [ ] Thread with 0 replies shows "0" in post count
- [ ] Pinned threads appear at top
- [ ] Closed threads show lock icon, reply box hidden

#### 3.3 Posts
- [ ] Reply to thread with plain text → appears below
- [ ] Reply with bold/italic/heading formatting → renders correctly
- [ ] Reply with link → link is clickable
- [ ] Reply with numbered list / bullet list → renders correctly
- [ ] Reply with code block → renders monospace
- [ ] Upload file attachment to post → downloadable
- [ ] Multiple attachments on single post
- [ ] Edit own post → content updates
- [ ] Delete own post → removed from thread
- [ ] Staff/admin can edit/delete any post

#### 3.4 Mentions
- [ ] Type @ in rich text editor → autocomplete dropdown shows users
- [ ] Select user → @mention inserted as link
- [ ] Mentioned user receives notification
- [ ] Click mention in post → navigates to that user's profile

#### 3.5 Reactions
- [ ] Click reaction button on post → picker opens
- [ ] Click reaction type → reaction added, count increases
- [ ] Click same reaction again → reaction removed
- [ ] Hover over reaction → tooltip shows who reacted
- [ ] All 6 reaction types work (👍 ❤️ 😂 😲 😢 🎉)
- [ ] Multiple users react → counts aggregate correctly

#### 3.6 Polls
- [ ] Create post with poll: question + 2+ options
- [ ] Single-choice poll: can only vote for one option
- [ ] Multi-choice poll: can vote for multiple
- [ ] Vote shown as highlighted
- [ ] Re-click vote → unvoted (toggle)
- [ ] Anonymous poll: cannot see who voted
- [ ] Non-anonymous poll: hover to see voter names
- [ ] Total vote count shown
- [ ] Creator can edit poll (change question/options)
- [ ] Creator can delete poll

#### 3.7 Drafts
- [ ] Start writing post, close browser, reopen thread → draft restored
- [ ] Submit post → draft cleared
- [ ] Start writing new thread, close browser, reopen subgroup → draft restored

#### 3.8 Files & Folders
- [ ] Create folder at subgroup root level
- [ ] Create nested subfolder
- [ ] Upload file to root level
- [ ] Upload file to folder
- [ ] Click file → preview or download (depending on type)
- [ ] Move file to different folder
- [ ] Delete file → confirmation, then removed
- [ ] Breadcrumb navigation when inside nested folders

---

## Section 4: Announcements

### Features
- All users can read announcements
- Rich text with attachments
- Priority ordering
- Create/edit/delete (own announcements or admin)
- Active/inactive state

### Test Cases

- [ ] Announcements page lists all active announcements newest first
- [ ] High-priority announcements appear first
- [ ] Click announcement → full content shown
- [ ] Create announcement with title + rich text → appears on page
- [ ] Add file attachment to announcement → downloadable
- [ ] Edit own announcement → changes saved
- [ ] Delete own announcement → removed from list (with confirmation)
- [ ] Admin can edit/delete any announcement
- [ ] Recent announcements shown in dashboard widget (top 3)
- [ ] Creating announcement sends notifications to relevant subscribers

---

## Section 5: Food Management

### Features

**Meal Registration:**
- Default preferences per day of week (Mon-Thu)
- Per-date registrations (eat in 17:30/18:30, takeaway, or not eating)
- Apply defaults to a whole week
- Registration stats (admin: see all)

**Food Tickets:**
- Offer surplus meal spots with optional price
- Other users can claim tickets
- Owner and claimer can release ticket

**Food Teams:**
- Cooking team assignments by date
- Swap requests between team members
- Cycle-based wish collection for next period's team generation
- Admin team generation from wishes

### Test Cases

#### 5.1 Meal Preferences (defaults)
- [ ] Set default for Monday: 2 adults, eat in, 18:30
- [ ] Set different default for each day
- [ ] Preferences saved and load correctly on next visit

#### 5.2 Meal Registration
- [ ] Navigate to Registration tab, select a future week
- [ ] Register for a day: toggle "Spiser" → eating status saved
- [ ] Change dining option: Fælles vs Takeaway
- [ ] Change seating time: 17:30 vs 18:30 (Fælles only)
- [ ] Deregister: toggle off → status removed
- [ ] "Apply defaults" button populates week with saved preferences
- [ ] Registration shows in admin stats immediately

#### 5.3 Food Tickets
- [ ] Create ticket for a future date with 2 adult portions, price 50kr
- [ ] Ticket appears in "Available Tickets" for other users
- [ ] Other user claims ticket → ticket shows claimed, owner sees claimer name + phone
- [ ] Claimer or owner can release ticket
- [ ] Create free ticket (no price) → shows as "Free"
- [ ] Cannot claim own ticket
- [ ] Delete unclaimed ticket (owner)
- [ ] Cannot delete already-claimed ticket

#### 5.4 Food Teams
- [ ] "My Teams" tab shows upcoming cooking assignments
- [ ] "All Teams" tab shows all upcoming teams
- [ ] Create swap request to another team member → request appears in their incoming list
- [ ] Target user accepts swap → both team assignments updated
- [ ] Target user declines swap → request marked declined
- [ ] Cancel outgoing swap request
- [ ] (Admin) Create a new cycle with date range and wish deadline
- [ ] Submit availability wish for a cycle (select available dates)
- [ ] (Admin) Generate teams → dry-run shows preview, actual run creates teams

---

## Section 6: Calendar & Events

### Features
- Month/Week/Day calendar views
- Community and private events
- RSVP with household members (self + children)
- Event linked to forum thread for discussion
- Room booking integration
- iCal export
- File upload to event
- Event cancellation (soft cancel, not delete)
- Email/push reminders (24h and 1h before)

### Test Cases

#### 6.1 Calendar View
- [ ] Calendar loads in month view by default
- [ ] Navigate previous/next month → events update
- [ ] Switch to week view → events shown in time slots
- [ ] Switch to day view → single-day detailed view
- [ ] Click empty time slot → event creation form with date/time pre-filled
- [ ] Filter by subgroup → only events for that subgroup shown
- [ ] Cancelled events shown with strikethrough or different styling

#### 6.2 Create Event
- [ ] Create event with title, date/time, location
- [ ] Create community event → visible to all users
- [ ] Create private event → only visible to creator (and invitees?)
- [ ] Link event to forum subgroup → discussion thread link shown
- [ ] Enable RSVP with deadline
- [ ] Assign rooms to event
- [ ] Event appears on calendar and in "Upcoming Events" widget on dashboard

#### 6.3 RSVP
- [ ] Event with RSVP enabled shows attendance form
- [ ] RSVP for self: Attending / Not Attending / No answer
- [ ] RSVP for children in household
- [ ] Attendance summary shows counts
- [ ] View full attendee list
- [ ] Update RSVP → counts update

#### 6.4 Event Management
- [ ] Edit own event → changes reflected on calendar
- [ ] Cancel event → shows as cancelled with message, not deleted
- [ ] Delete event → removed from calendar (with confirmation)
- [ ] Download .ics file → opens in calendar app
- [ ] Upload file to event → downloadable from event detail

---

## Section 7: Room Bookings

### Features
- Admin-managed bookable rooms
- One-time and recurring bookings
- Recurring booking exceptions (single-date cancellations)
- Calendar view with room filtering
- Availability check

### Test Cases

- [ ] Room bookings calendar loads showing all rooms
- [ ] Filter calendar by specific room
- [ ] Click time slot → create booking form
- [ ] Create booking with title, date/time, room → appears on calendar
- [ ] (Admin) Create recurring booking (e.g., every Monday 17:00-18:00)
- [ ] Recurring booking expands across multiple weeks
- [ ] (Admin) Add exception to recurring booking → that date excluded
- [ ] Check availability API: request overlapping time → shows conflict
- [ ] Edit own booking
- [ ] Delete own booking (single occurrence vs all)

---

## Section 8: Direct Messaging

### Features
- 1-on-1 and group conversations
- Real-time delivery via WebSocket
- Typing indicators
- Read receipts (single = sent, double = read)
- File attachments
- Edit and unsend messages
- Add participants to existing conversation
- Leave group conversation

### Test Cases

#### 8.1 Conversations
- [ ] Create new conversation with another user
- [ ] Conversation appears in list for both users
- [ ] Create group conversation with 3+ users
- [ ] Conversations sorted by most recent activity
- [ ] Search conversations by participant name

#### 8.2 Real-time Messaging
- [ ] Send message → appears immediately for sender
- [ ] Recipient receives message in real-time (without page refresh)
- [ ] Start typing → "X is typing..." shown to other party within ~1 second
- [ ] Stop typing → typing indicator disappears
- [ ] Multiple users typing simultaneously shows all indicators

#### 8.3 Read Receipts
- [ ] Send message → single checkmark shown
- [ ] Recipient opens conversation → double checkmark shown
- [ ] Unread count badge clears when opening conversation

#### 8.4 File Attachments
- [ ] Send message with image attachment → image preview shown
- [ ] Send message with non-image file → file download link shown
- [ ] Multiple attachments in one message

#### 8.5 Message Actions
- [ ] Edit own message → content updates for both parties in real-time
- [ ] "Unsend" message → replaced with "message deleted" indicator
- [ ] Cannot edit/delete other user's messages

#### 8.6 Group Conversations
- [ ] Add new participant to existing group
- [ ] Leave group conversation (only when 3+ members remain)
- [ ] System message shown when participant added/left

---

## Section 9: Notifications

### Features
- In-app notifications with type icons
- Email notifications (per-type toggles)
- Web Push notifications (opt-in, per-type toggles)
- 13+ notification types (messages, forum, events, food tickets, mentions, etc.)
- Mark read/unread/delete individually or in bulk
- Navigate to relevant content via notification link

### Test Cases

#### 9.1 Notification Triggers
- [ ] Send message → recipient gets "new_message" notification
- [ ] Create forum post in subscribed subgroup → subscribers get notification
- [ ] Reply to thread → thread creator/participants get notification
- [ ] React to post → post author gets reaction notification
- [ ] Mention user with @ → mentioned user gets mention notification
- [ ] Create event → community gets event_created notification
- [ ] Create food ticket → relevant users notified
- [ ] 24h before event → reminder notification sent (background task)
- [ ] 1h before event → reminder notification sent

#### 9.2 Notification UI
- [ ] Bell icon in header shows unread count badge
- [ ] Open notifications page → list of all notifications
- [ ] Click notification → navigates to related content
- [ ] Notification marked as read after clicking
- [ ] Manually mark as read / unread
- [ ] Delete single notification
- [ ] "Mark all as read" → all cleared
- [ ] Delete all notifications

#### 9.3 Notification Preferences
- [ ] Disable email for "new_message" → no email received for new message
- [ ] Enable push notifications → browser permission prompt
- [ ] Subscribe to push → test push notification received
- [ ] Disable push for a type → no push received for that type
- [ ] Preferences persisted across sessions

---

## Section 10: Global Search

### Features
- Full-text search across all content (FTS5 with recency boost)
- Results grouped by type: users, threads, posts, subgroups, announcements, events, houses, cars, files
- Special shortcuts: house number, license plate, user name prefix
- Keyboard navigation (arrow keys, enter)
- Accessible via Cmd/Ctrl+K or header icon

### Test Cases

- [ ] Open search with Ctrl+K (or Cmd+K on Mac)
- [ ] Search for a user's name → user result appears
- [ ] Click user result → navigates to profile
- [ ] Search for a forum post keyword → thread/post results appear
- [ ] Search for house number (e.g., "42") → direct house result
- [ ] Search for partial license plate → car result appears
- [ ] Search for announcement title → announcement result
- [ ] Search for event title → event result
- [ ] Search for filename → file result with preview
- [ ] Empty query → no results (not error)
- [ ] Non-matching query → empty state shown
- [ ] Keyboard navigation: arrow down/up moves selection, Enter navigates

---

## Section 11: Useful Links

### Features
- Staff-editable HTML page of useful links
- All users can view

### Test Cases

- [ ] View links page → content shown as formatted HTML
- [ ] (Staff) Click edit → rich text editor opens
- [ ] Edit content, save → new content shown
- [ ] (Non-staff) No edit button visible

---

## Section 12: Grafisk overblik (Organisation overview)

### Features
- Organisation tree at `/overblik` showing **organer** (fixed top-level types, in fixed
  display order: Generalforsamling → Fællesmøde → Bestyrelse → Udvalg, alphabetical within
  Udvalg) and **arbejdsgrupper** nested under them to arbitrary depth (organer can parent
  arbejdsgrupper, and arbejdsgrupper can parent further arbejdsgrupper).
- **Almindelige grupper** (plain forum groups) are excluded from `/overblik` entirely — they
  only ever appear in the regular `/forum` list.
- Archiving (`is_active = False`) hides a subgroup from the default `/forum` list and from
  `/overblik` by default; both have an opt-in switch ("Vis arkiverede" / "Vis afsluttede
  arbejdsgrupper") to reveal archived/afsluttede groups. Archiving an arbejdsgruppe that still
  has an active child hides the whole subtree until the switch is toggled on.
- Users can create **Arbejdsgruppe** or **Almindelig gruppe** from the UI (via the create-group
  modal, reachable from both `/forum` and `/overblik`). Creating an arbejdsgruppe requires
  picking a parent (an organ or another arbejdsgruppe) and supports optional establish/expiry
  dates. Creating/editing/deleting **organ types** (Generalforsamling, Fællesmøde, Bestyrelse,
  Udvalg) and reparenting/deleting organer is **admin-only and only available in Django admin**
  — there is no app-UI path for it.
- All users are automatically subscribed to **Generalforsamling** and **Fællesmøde**.

### Setup / Preconditions

- Dev servers running: `uv run dev.py` (frontend http://localhost:5173, backend daphne on
  port 7000).
- Seed data required (organ types/reparenting via Django admin — admin-only; arbejdsgrupper via
  the in-app create-modal):
  - The two fixed organer **Generalforsamling** and **Fællesmøde** (seeded by migration),
    a **Bestyrelsen**, and **at least 1 Udvalg**.
  - **At least 1 arbejdsgruppe** directly under an organ, plus **at least 1 grandchild**
    arbejdsgruppe nested under that arbejdsgruppe (≥2 levels deep).
  - **At least 1 archived arbejdsgruppe that still has an active child** — needed to exercise
    the subtree-hiding rule.
  - **At least 1 almindelig gruppe** — used to confirm it never shows up in `/overblik`.
- Three test personas (e.g. seeded with a shared default password, emails like
  `<name>.<house>@kb.local`):
  1. **Staff/admin** user.
  2. A **member of an organ** (e.g. a member of Bestyrelsen).
  3. A **non-member, non-staff** regular user.

### Test Cases

#### 12.A Navbar + `/overblik` read view
- [ ] Navbar shows a "Grafisk overblik" entry (sitemap icon) → navigates to `/overblik`.
- [ ] Root nodes render in fixed order: Generalforsamling → Fællesmøde → Bestyrelse → Udvalg
      (Udvalg entries alphabetical).
- [ ] Arbejdsgrupper render nested under their organ; the ≥2-level grandchild arbejdsgruppe
      renders correctly when its branch is expanded.
- [ ] Almindelige grupper appear **nowhere** in the `/overblik` tree.
- [ ] Each node shows: the name as a link to `/forum/<slug>`, a truncated formål/description,
      member avatars + count (e.g. "N medlem"/"N medlemmer"), and dates ("Oprettet: <date>" /
      "Udløber: <date>") when set.
- [ ] Folding/unfolding a branch (chevron toggle) works, including at a narrow mobile viewport
      (~375px).
- [ ] The "Vis afsluttede arbejdsgrupper" switch is **off** by default → the archived
      arbejdsgruppe and its active child are both hidden. Toggling it **on** reveals the
      archived group with an "Afsluttet" badge, and its subtree (including the active child)
      reappears.

#### 12.B Top-organ subscriptions
- [ ] As the regular (non-member) user, `/forum` shows **Generalforsamling** and
      **Fællesmøde** under the "Grupper du abonnerer på" section; clicking either opens its
      group page.

#### 12.C Create flows
- [ ] The create-group modal ("Opret ny gruppe") opens both from the "Opret gruppe" button on
      `/forum` and the "Opret arbejdsgruppe" button on `/overblik`; a type selector
      (SegmentedControl: "Almindelig gruppe" / "Arbejdsgruppe") is shown.
- [ ] **Almindelig gruppe**: selecting it shows no "Forælder" select and no date inputs; after
      creating, the new group shows in `/forum` but **not** in `/overblik`.
- [ ] **Arbejdsgruppe**: selecting it reveals the "Forælder" Select (listing organer and
      arbejdsgrupper, indented by depth, searchable) plus "Oprettelsesdato" and "Udløbsdato"
      date inputs. Pick a parent organ, optionally set dates, and create.
- [ ] The new arbejdsgruppe appears under its chosen parent in `/overblik` immediately (after
      refetch) and has a working forum group page at `/forum/<slug>`.
- [ ] As the non-staff user, only "Arbejdsgruppe" / "Almindelig gruppe" are offered in the type
      selector — no organ type (Generalforsamling/Fællesmøde/Bestyrelse/Udvalg) can be chosen or
      created from the UI.

#### 12.D Subgroup page: parent/children chips + dates
- [ ] On an arbejdsgruppe's page, a parent breadcrumb (a "←" chevron + the parent's name, e.g.
      "← Bestyrelsen") links back to the parent group.
- [ ] If the group has children, an "Arbejdsgrupper" chip section lists each sub-group as a
      clickable badge linking to `/forum/<child-slug>`.
- [ ] `established_on` / `expires_on` show as "Oprettet: <date>" / "Udløber: <date>" under the
      group title when set.

#### 12.E Archiving round-trip
- [ ] From the group's "⋯" menu, "Markér som afsluttet" on an arbejdsgruppe removes it from the
      default `/forum` list and from `/overblik`; its direct URL `/forum/<slug>` still loads and
      shows an "Afsluttet" badge next to the group name.
- [ ] Toggling "Vis arkiverede" on `/forum` reveals it again in the list.
- [ ] Reopening the same menu on the archived group now shows "Genåbn gruppe"; clicking it
      restores the group to both the default `/forum` list and `/overblik`.

#### 12.F Permission gate
- [ ] As the **non-member, non-staff** user: editing an **organ's** name/description via
      "Rediger gruppe" is blocked — either no edit affordance is usable, or attempting the save
      produces a 403/error toast ("Kunne ikke opdatere gruppen.").
- [ ] As a **member of that organ** (or as staff): the same "Rediger gruppe" edit succeeds and
      shows "Gruppe opdateret" / "Ændringerne er gemt."
- [ ] Any authenticated user can edit, reparent (via the create/edit flow's parent select), and
      archive/reopen an **arbejdsgruppe** ("Markér som afsluttet" / "Genåbn gruppe" is offered to
      any authenticated user on arbejdsgrupper, per the `canArchive` rule).
- [ ] No app-UI path exists to create, reparent, or delete an **organ** type
      (Generalforsamling/Fællesmøde/Bestyrelse/Udvalg) — confirmed admin-only via Django admin.

#### 12.G `/forum` "Udvalg" section + regression
- [ ] `/forum`'s "Udvalg" section lists committees exactly as before (now driven by
      `group_type === "udvalg"` instead of the old `is_committee` flag); archived committees are
      not shown unless "Vis arkiverede" is on.
- [ ] Smoke test: the forum list still loads, opening a thread still works, and group
      membership still works — confirms the `is_committee` → `group_type` migration didn't break
      grouping or the list.

---

## Section 13: Dashboard

### Features
- Welcome message
- Unread notifications banner
- Recent announcements widget (top 3)
- Food menu widget (today + next food day)
- Recent forum activity (5 posts)
- Upcoming birthdays (next 7 days)
- Upcoming events (next 5)

### Test Cases

- [ ] Dashboard loads with all widgets
- [ ] Unread notifications banner shows when there are unread notifications
- [ ] Notifications banner shows notification previews, "See all" navigates to notifications page
- [ ] Food widget shows today's menu (Mon-Thu only)
- [ ] Food widget: toggle eating/not eating → persists
- [ ] Food widget: change dining option → persists
- [ ] Upcoming birthdays shows correct age
- [ ] Upcoming events shows RSVP status if applicable
- [ ] Recent forum activity links to correct posts (with anchor)

---

## Testing Procedure

### Setup

**Accounts needed:**
1. **User A** (regular user, House 1)
2. **User B** (regular user, House 2)
3. **Admin user** (staff access for admin features)

**Devices/browsers to cover:**
- Desktop Chrome (primary)
- Desktop Firefox
- Mobile Chrome (iOS or Android)
- Mobile Safari (iOS)

### Procedure Order

Test features in dependency order:

```
1. Auth (login/register/reset)  ← everything depends on this
2. Profile & Directory          ← needed for messaging tests
3. Notifications (preferences)  ← set up before triggering events
4. Forum                        ← threads needed for notifications
5. Announcements
6. Food Management
7. Calendar & Events
8. Room Bookings
9. Direct Messaging             ← test real-time features here
10. Notifications (review)      ← verify all triggers from above
11. Global Search               ← needs content from above steps
12. Dashboard                   ← verify widgets with real content
13. Useful Links
```

### Real-time / Two-Browser Tests

Some tests require two simultaneous browser sessions (different users):

| Feature | Test |
|---|---|
| Messaging | Send message, see it arrive in real time |
| Messaging | Typing indicators |
| Messaging | Read receipts |
| Notifications | Receive notification when another user posts |
| Forum | See new post without refresh |
| Header badge | Unread count updates in real time |

Easiest setup: open two browsers (or one normal + one incognito), log in as User A and User B.

### Admin-only Features

Log in as admin for:
- Creating invitations
- Generating food teams
- Creating/managing food cycles
- Creating/managing bookable rooms
- Creating/managing recurring bookings
- Editing useful links
- Admin monthly food cost report

---

## Automation Candidates

### High Priority (test critical paths that would be catastrophic to break)

| Feature | Type | Rationale |
|---|---|---|
| Login / logout | Integration | Every user does this; broken login = no access |
| JWT refresh | Integration | Session expiry is silent breakage |
| Meal registration (toggle eating) | E2E | Core daily feature for ~90 users |
| Post to forum thread | E2E | Primary communication channel |
| Send direct message | E2E | High-frequency use |
| Create / RSVP event | E2E | Calendar coordination |
| Notification delivery (in-app) | Integration | Notification triggers on forum post, message |
| Search returns relevant results | Integration | FTS5 index consistency |
| Password reset flow | E2E | Recovery from locked-out accounts |

### Medium Priority (important features, less catastrophic if broken)

| Feature | Type | Rationale |
|---|---|---|
| Forum reactions | Unit/Integration | Simple toggle logic, easy to test |
| Poll voting | Integration | Toggle semantics (add/remove vote) |
| Food ticket claim/release | Integration | State transitions are clear |
| Team swap request lifecycle | Integration | pending → accepted/declined states |
| File upload + download | E2E | Multiple entry points |
| @mention creates notification | Integration | Mention → notification pipeline |
| Mark all notifications read | Integration | Bulk operation |
| House edit (children/cars) | E2E | CRUD with confirmation dialogs |
| Global search heuristics | Unit | House number, license plate, name prefix matching |

### Lower Priority / Hard to Automate

| Feature | Why harder |
|---|---|
| Real-time typing indicators | Requires two WebSocket clients + timing |
| Read receipts | Same — two simultaneous sessions |
| Push notifications | Requires browser push API, hard in headless |
| Email delivery | Needs SMTP mock / email capture |
| Food team generation algorithm | Complex business logic, better as unit test on algorithm |
| Google Drive menu cache | External dependency |
| Rich text formatting (Tiptap) | Complex DOM interactions |
| File preview modals | Visual fidelity hard to assert |
| Dark/light theme switching | Visual regression |

### Existing Automated Test Coverage

- Backend: `uv run pytest` — check `backend/apps/*/tests.py`
- Frontend: `npm run test:run` — check `frontend/src/**/*.test.ts`

### Recommended Test Stack for New Automation

- **Backend API integration tests**: pytest + `pytest-django` + DRF `APIClient` — already in place
- **Frontend component tests**: Vitest + Testing Library — already in place
- **E2E tests**: Playwright — not yet set up, would cover the critical path E2E items above

### Suggested E2E Test File Structure (if adding Playwright)

```
frontend/tests/e2e/
  auth.spec.ts              # Login, logout, password reset
  forum.spec.ts             # Create thread, reply, react
  messaging.spec.ts         # Conversations, send messages
  food-registration.spec.ts # Register for meals
  notifications.spec.ts     # Notification triggers and read status
  search.spec.ts            # Global search scenarios
```

---

## Known Edge Cases to Verify

1. **Food registration**: Mon-Thu only — does the UI disable other days?
2. **Closed thread**: reply box should be hidden/disabled
3. **Swap request**: cannot request swap with yourself
4. **Ticket**: cannot claim your own ticket
5. **Group chat**: leave requires at least 3 participants remaining
6. **Poll votes**: multi-choice vs single-choice enforcement
7. **Anonymous poll**: voter names hidden even for creator
8. **Invitation token**: one-time use only, 7-day expiry
9. **Password reset token**: 1-hour expiry, one-time use
10. **File upload**: size limits enforced in UI and backend
11. **Notification preferences**: disabling in-app should not affect email (independent toggles)
12. **Search index staleness**: after creating content, it should appear in search within seconds
13. **WebSocket reconnect**: disconnect wifi briefly → messages still deliver when reconnected
14. **Concurrent food registrations**: two family members editing same day's registration
