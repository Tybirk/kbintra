# Systematic Code Review - KB Intra

## Orchestrator Instructions

**Read this file and execute the code review by launching subagents for each module.**

### How to Start
1. Read this entire document for context
2. Launch subagents using the Task tool with `subagent_type: "general-purpose"` for each module listed below
3. Run agents in parallel (all 10 at once) for efficiency
4. Each agent works autonomously - no user confirmation needed
5. Monitor progress by checking for created `REVIEW_*.md` files and git commits

### Agent Prompt Template
Use this prompt structure when launching each agent:

```
You are reviewing the {MODULE_NAME} module of KB Intra, a community platform for ~100 users (~20 concurrent max).

**CONTEXT:**
- Simpler solutions preferred (polling OK, SQLite fine for this scale)
- Tech: Django 5 + DRF + Channels | React 19 + Mantine + Zustand + React Query
- **Must work on: Desktop web, Mobile web, and PWA (installable app)**
- Backend commands: `cd /home/tybirk/projects/kbintra/backend && uv run ...`
- Frontend commands: `cd /home/tybirk/projects/kbintra/frontend && npm run ...`

**YOUR TASK - Work Autonomously:**
1. Read and analyze all files listed below for bugs and readability issues
2. Fix bugs directly - no user confirmation needed
3. Add tests for bugs found or complex untested logic
4. Run linters before committing:
   - Backend: `cd /home/tybirk/projects/kbintra/backend && uv run ruff check --fix . && uv run ruff format .`
   - Frontend: `cd /home/tybirk/projects/kbintra/frontend && npm run lint && npm run format`
5. Commit each logical fix with format:
   ```
   fix({module}): <short description>

   - <what was wrong>
   - <what was fixed>
   - <tests added if any>

   Co-Authored-By: Claude Code <noreply@anthropic.com>
   ```
6. Create `/home/tybirk/projects/kbintra/REVIEW_{MODULE}.md` with:
   - Summary of findings
   - Each bug: file:line, severity (Critical/High/Medium/Low), description
   - What was fixed and how
   - Tests added
   - Issues NOT fixed (and why)
   - List of commits made
7. Update `/home/tybirk/projects/kbintra/CODE_REVIEW.md`:
   - Set module status to "completed"
   - Fill in Findings section
   - List commits
   - Update Summary table counts

**FILES TO REVIEW:**
{FILE_LIST}

**FOCUS AREAS:**
{FOCUS_AREAS}

**BUG CHECKLIST:**
- Race conditions in concurrent operations
- Missing null/undefined checks
- Incorrect error handling (swallowed errors, wrong status codes)
- Authentication/authorization bypasses
- Data validation gaps
- State management issues (stale data, cache invalidation)
- Database query issues (N+1, missing transactions)
- Memory leaks (event listeners, subscriptions)
- Timezone/date handling issues
- XSS or injection vulnerabilities

**MOBILE & PWA CHECKLIST:**
- Touch interactions not working (hover-only interactions, small tap targets)
- Layouts broken on small screens (fixed widths, overflow issues)
- Forms unusable on mobile (keyboard covering inputs, no proper input types)
- Service worker caching issues (stale data, offline not working)
- PWA manifest issues (icons, display mode, theme colors)
- Network handling (no offline fallback, no retry on reconnect)
- Viewport/scroll issues (body scroll lock, 100vh problems on mobile)
- Performance on mobile (large bundles, unoptimized images)

**READABILITY CHECKLIST:**
- Overly complex logic
- Dead code or unused imports
- Functions doing too many things
- Duplicated logic
```

---

## Project Context

- **Platform**: KB Intra - community communication platform for co-living (~100 users)
- **Scale**: ~20 concurrent users max - simpler solutions preferred
- **Backend**: Django 5 + DRF + Django Channels (WebSockets) + SQLite
- **Frontend**: React 19 + TypeScript + Vite + Mantine UI v8 + Zustand + React Query
- **Deployment**: Desktop web, mobile web, and PWA (installable) - all must work well

---

## Review Modules

### Module 1: Food System
**Status**: completed
**Review File**: `REVIEW_FOOD.md`
**Agent Description**: "Review Food System module"

**Files**:
- `backend/apps/food/models.py` (536 lines)
- `backend/apps/food/views.py` (1144 lines)
- `backend/apps/food/serializers.py` (794 lines)
- `backend/apps/food/admin.py`
- `backend/apps/food/urls.py`
- `frontend/src/pages/FoodPage.tsx`
- `frontend/src/pages/FoodTeamsPage.tsx`
- `frontend/src/pages/FoodTicketsPage.tsx`
- `frontend/src/pages/FoodPreferencesPage.tsx`
- `frontend/src/api/food.ts`

**Focus**: Meal registration logic, ticket transfers, food team rotation, date handling, concurrent registration, **table/grid layouts on mobile**

**Findings**:
- Race condition in ClaimTicketView (Medium) - Fixed with transaction.atomic() + select_for_update()
- Missing admin registrations (Low) - Added 5 models to admin
- useState initialization bug (Medium) - Changed to useEffect with dependency
- English day labels (Low) - Translated to Danish
- Table overflow on mobile (Low) - Added Table.ScrollContainer

**Commits**:
- `1b1f05f` fix(food): fix race condition and add missing admin registrations
- `655f724` fix(food): fix useState bug and translate to Danish
- `bcb0c1c` fix(food): add horizontal scroll to tables for mobile

---

### Module 2: Forum System
**Status**: pending
**Review File**: `REVIEW_FORUM.md`
**Agent Description**: "Review Forum System module"

**Files**:
- `backend/apps/forum/models.py` (269 lines)
- `backend/apps/forum/views.py` (423 lines)
- `backend/apps/forum/serializers.py` (487 lines)
- `backend/apps/forum/utils.py`
- `backend/apps/forum/admin.py`
- `backend/apps/forum/urls.py`
- `frontend/src/pages/ForumPage.tsx`
- `frontend/src/pages/SubgroupPage.tsx`
- `frontend/src/pages/ThreadPage.tsx`
- `frontend/src/api/forum.ts`

**Focus**: Subgroup permissions, file uploads, HTML sanitization (Tiptap), reactions, pagination

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

### Module 3: Messaging & WebSockets
**Status**: completed
**Review File**: `REVIEW_MESSAGING.md`
**Agent Description**: "Review Messaging WebSocket module"

**Files**:
- `backend/apps/messaging/models.py` (101 lines)
- `backend/apps/messaging/views.py` (369 lines)
- `backend/apps/messaging/serializers.py` (278 lines)
- `backend/apps/messaging/consumers.py` (300 lines)
- `backend/config/asgi.py`
- `frontend/src/pages/MessagesPage.tsx`
- `frontend/src/api/messaging.ts`

**Focus**: WebSocket reliability, reconnection, message delivery, typing indicators, JWT validation, race conditions, **mobile keyboard handling**, **touch scrolling in chat**

**Findings**:
- Fixed XSS risk (High): Removed unnecessary dangerouslySetInnerHTML - messages are plain text
- Fixed N+1 queries (Medium): Used bulk_create in 3 places instead of looping get_or_create
- Fixed memory leaks (Medium): Object URLs now properly revoked, event listeners cleaned up
- Fixed mobile UX (Medium): Changed 100vh to 100dvh for keyboard-aware height
- Added logging for silent exception handlers

**Commits**:
- `2218894` - fix(messaging): Address multiple bugs from code review

---

### Module 4: Bookings System
**Status**: completed
**Review File**: `REVIEW_BOOKINGS.md`
**Agent Description**: "Review Bookings System module"

**Files**:
- `backend/apps/bookings/models.py` (136 lines)
- `backend/apps/bookings/views.py` (329 lines)
- `backend/apps/bookings/serializers.py` (334 lines)
- `backend/apps/bookings/validators.py`
- `backend/apps/bookings/admin.py`
- `backend/apps/bookings/urls.py`
- `frontend/src/pages/BookingsPage.tsx` (67KB - very large!)
- `frontend/src/api/bookings.ts`

**Focus**: Overlap/conflict detection, recurring bookings, timezone handling, concurrent booking races, **calendar/date picker mobile UX**

**Findings**:
- Race condition in booking creation (Medium) - Fixed with transaction.atomic() + re-check
- Race condition in booking update (Medium) - Fixed with same pattern
- useMemo used for side effects (Medium) - Changed to useEffect
- Missing date validation in exception endpoint (Low) - Added format validation

**Commits**:
- `d9e7c2c` - Various bugfixes (includes bookings race condition fixes)
- `6c3e8fd` - test(bookings): add comprehensive tests for booking system

---

### Module 5: User & Auth System
**Status**: pending
**Review File**: `REVIEW_AUTH.md`
**Agent Description**: "Review User Auth System module"

**Files**:
- `backend/apps/users/models.py` (220 lines)
- `backend/apps/users/views.py` (251 lines)
- `backend/apps/users/serializers.py` (282 lines)
- `backend/apps/users/admin.py`
- `backend/apps/users/urls.py`
- `backend/apps/users/urls_users.py`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/RegisterPage.tsx`
- `frontend/src/pages/ProfilePage.tsx`
- `frontend/src/pages/ProfileEditPage.tsx`
- `frontend/src/pages/ChangePasswordPage.tsx`
- `frontend/src/pages/ForgotPasswordPage.tsx`
- `frontend/src/pages/ResetPasswordPage.tsx`
- `frontend/src/api/auth.ts`
- `frontend/src/api/users.ts`
- `frontend/src/store/authStore.ts`

**Focus**: JWT refresh flow, password reset security, invitation system, session management, auth state

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

### Module 6: Notifications System
**Status**: pending
**Review File**: `REVIEW_NOTIFICATIONS.md`
**Agent Description**: "Review Notifications System module"

**Files**:
- `backend/apps/notifications/models.py` (132 lines)
- `backend/apps/notifications/views.py` (157 lines)
- `backend/apps/notifications/serializers.py` (150 lines)
- `backend/apps/notifications/services.py`
- `backend/apps/notifications/email_service.py`
- `backend/apps/notifications/admin.py`
- `backend/apps/notifications/urls.py`
- `frontend/src/pages/NotificationsPage.tsx`
- `frontend/src/api/notifications.ts`

**Focus**: Push subscriptions, email delivery, preference enforcement, unread count accuracy

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

### Module 7: Houses & Directory
**Status**: completed
**Review File**: `REVIEW_HOUSES.md`
**Agent Description**: "Review Houses Directory module"

**Files**:
- `backend/apps/houses/models.py` (53 lines)
- `backend/apps/houses/views.py` (155 lines)
- `backend/apps/houses/serializers.py` (119 lines)
- `backend/apps/houses/admin.py`
- `backend/apps/houses/urls.py`
- `frontend/src/pages/DirectoryPage.tsx`
- `frontend/src/pages/HouseDetailPage.tsx`
- `frontend/src/pages/HouseEditPage.tsx`
- `frontend/src/api/houses.ts`

**Focus**: House member management, profile pictures, children data, edit permissions

**Findings**:
- N+1 query in HouseSerializer.get_inhabitant_count (Medium) - Fixed with len() on prefetched data
- N+1 query in HouseListSerializer.get_inhabitant_count (Medium) - Fixed with len() on prefetched data
- Missing prefetch_related in MyHouseView (Medium) - Added prefetch calls
- Small mobile touch targets for ActionIcons (Low) - Added size="lg"
- Table overflow on mobile (Low) - Added Table.ScrollContainer
- English error messages (Low) - Translated to Danish

**Commits**:
- `153db63` fix(houses): fix N+1 query issues in house serializers and views
- `73fb047` fix(houses): improve mobile UX and translate to Danish

---

### Module 8: Calendar & Announcements
**Status**: pending
**Review File**: `REVIEW_CALENDAR.md`
**Agent Description**: "Review Calendar Announcements module"

**Files**:
- `backend/apps/calendar_app/models.py` (30 lines)
- `backend/apps/calendar_app/views.py` (80 lines)
- `backend/apps/calendar_app/serializers.py` (74 lines)
- `backend/apps/calendar_app/admin.py`
- `backend/apps/calendar_app/urls.py`
- `backend/apps/announcements/models.py` (61 lines)
- `backend/apps/announcements/views.py` (57 lines)
- `backend/apps/announcements/serializers.py` (113 lines)
- `backend/apps/announcements/admin.py`
- `backend/apps/announcements/urls.py`
- `frontend/src/pages/CalendarPage.tsx`
- `frontend/src/pages/AnnouncementsPage.tsx`
- `frontend/src/api/calendar.ts`
- `frontend/src/api/announcements.ts`

**Focus**: Event date/timezone handling, recurring events, announcement priority/expiration, **calendar view mobile layout**

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

### Module 9: Search System
**Status**: pending
**Review File**: `REVIEW_SEARCH.md`
**Agent Description**: "Review Search System module"

**Files**:
- `backend/apps/search/views.py` (196 lines)
- `frontend/src/api/search.ts`
- `frontend/src/components/GlobalSearch.tsx`

**Focus**: Query sanitization, permission filtering, result ranking

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

### Module 10: Shared Infrastructure
**Status**: pending
**Review File**: `REVIEW_INFRASTRUCTURE.md`
**Agent Description**: "Review Shared Infrastructure module"

**Files**:
- `backend/config/settings.py`
- `backend/config/urls.py`
- `backend/config/asgi.py`
- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/store/authStore.ts`
- `frontend/src/components/AppHeader.tsx`
- `frontend/src/components/AppNavbar.tsx`
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/RichTextEditor.tsx`
- `frontend/src/components/ChatRichTextEditor.tsx`
- `frontend/src/components/AttachmentCarousel.tsx`
- `frontend/src/components/FilePreview.tsx`
- `frontend/src/components/Reactions.tsx`
- `frontend/src/components/EmojiPicker.tsx`
- `frontend/src/components/InstallPrompt.tsx`
- `frontend/src/components/AttachmentBadge.tsx`
- `frontend/src/hooks/useVersionCheck.ts`
- `frontend/src/sw.ts`
- `frontend/src/types/index.ts`
- `frontend/public/manifest.json` (if exists)
- `frontend/index.html`

**Focus**: Token refresh interceptor, error boundaries, route protection, CORS, **PWA/service worker caching**, **mobile navigation/layout**, type consistency, **offline handling**

**Findings**:
<!-- Agent updates this section -->

**Commits**:
<!-- Agent lists commits here -->

---

## Summary

| Module | Status | Bugs Found | Bugs Fixed | Tests Added |
|--------|--------|------------|------------|-------------|
| 1. Food System | completed | 5 | 5 | 0 |
| 2. Forum System | pending | - | - | - |
| 3. Messaging & WebSockets | completed | 10 | 9 | 0 |
| 4. Bookings System | completed | 4 | 4 | 12 |
| 5. User & Auth System | pending | - | - | - |
| 6. Notifications System | pending | - | - | - |
| 7. Houses & Directory | completed | 6 | 6 | 0 |
| 8. Calendar & Announcements | pending | - | - | - |
| 9. Search System | pending | - | - | - |
| 10. Shared Infrastructure | pending | - | - | - |

**Total**: 25 bugs found, 24 fixed, 12 tests added

---

## Post-Review Checklist

After all modules are reviewed, run full validation:
```bash
# Backend
cd /home/tybirk/projects/kbintra/backend
uv run ruff check .
uv run ruff format --check .
uvx ty check
uv run pytest

# Frontend
cd /home/tybirk/projects/kbintra/frontend
npm run lint
npm run format:check
npm run typecheck
npm run test:run
```

- [ ] All backend tests pass
- [ ] All frontend tests pass
- [ ] No linter errors
- [ ] No type errors
- [ ] All REVIEW_*.md files created
- [ ] Summary table updated
