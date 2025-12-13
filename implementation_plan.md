# KB Intra - Community Communication Platform

## Project Overview
An internal communication platform for a co-living community with forum, food management, messaging, calendar, and resident directory features.

## Clarified Requirements
- **Subgroups**: All public, users subscribe to groups. Default subscriptions: "Common" and "Important posts"
- **Cooking duties**: Deferred to later phase (admin assigns when implemented)
- **Permissions**: Minimal - Django admin for admins, otherwise equal access. Users can only edit/delete own content.
- **Platform**: Web + PWA with push notifications
- **Food tickets**: Users can offer unused meal spots for free or with a price. Payment handled externally (MobilePay etc.). Seller's phone number shown so buyer can contact.
- **Scale**: ~90 users, 58 houses. Simple infrastructure sufficient.

## Tech Stack
- **Backend**: Django 5.x with Django REST Framework
- **Frontend**: React 18 with Vite, Mantine UI v7, TypeScript
- **Database**: SQLite for development, PostgreSQL for production
- **Authentication**: JWT via djangorestframework-simplejwt
- **Real-time**: Django Channels with WebSockets (InMemoryChannelLayer - sufficient for ~90 users)
- **File Storage**: Django's file handling (local storage)
- **Notifications**: Web Push API (via pywebpush) + email via Django
- **PWA**: Vite PWA plugin for installability

---

## Project Structure

```
kbintra/
├── backend/
│   ├── config/                 # Django project settings
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── asgi.py            # For WebSocket support
│   │   └── wsgi.py
│   ├── apps/
│   │   ├── users/             # User management & profiles
│   │   ├── houses/            # Houses and inhabitants
│   │   ├── forum/             # Forum with subgroups, threads, files
│   │   ├── announcements/     # Important/pinned posts
│   │   ├── food/              # Food module (menus, registration, duties)
│   │   ├── calendar/          # Community calendar
│   │   ├── messaging/         # Direct messaging system
│   │   └── notifications/     # Notification system
│   ├── manage.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/        # Shared components
│   │   ├── pages/             # Page components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── api/               # API client functions
│   │   ├── store/             # State management (Zustand)
│   │   └── utils/             # Utility functions
│   ├── package.json
│   └── vite.config.ts
└── docker-compose.yml         # Optional containerization
```

---

## Database Models

### Users App
```python
User (AbstractUser extension):
  - email (unique, used for login)
  - phone_number
  - birthdate
  - profile_picture
  - bio
  - house (FK to House)
  - is_active
  - date_joined

Invitation:
  - email
  - token (unique)
  - created_by (FK to User)
  - created_at
  - used_at (nullable)
  - expires_at
```

### Houses App
```python
House:
  - name/number
  - description
  - address (optional)

# Inhabitants linked via User.house FK
```

### Forum App
```python
Subgroup:
  - name
  - description
  - slug
  - created_at
  - is_default (boolean - auto-subscribe new users, e.g., "Common", "Important posts")

SubgroupSubscription:
  - user (FK)
  - subgroup (FK)
  - notify_new_threads (boolean)
  - notify_replies (boolean)
  - created_at

Thread:
  - subgroup (FK)
  - title
  - author (FK to User)
  - created_at
  - updated_at
  - is_pinned

Post:
  - thread (FK)
  - author (FK to User)
  - content (rich text)
  - created_at
  - updated_at

Folder:
  - subgroup (FK)
  - name
  - parent (FK to self, nullable)

File:
  - folder (FK)
  - uploaded_by (FK to User)
  - file
  - name
  - uploaded_at
```

### Announcements App
```python
Announcement:
  - title
  - content
  - author (FK to User)
  - created_at
  - updated_at
  - is_active
  - priority (for ordering)
```

### Food App
```python
WeeklyMenu:
  - week_start_date
  - created_by (FK to User)

DailyMenu:
  - weekly_menu (FK)
  - date
  - day_of_week (Mon-Thu)
  - description
  - has_meat_option (boolean, mainly for Wednesday)
  - meat_description (optional)
  - vegetarian_description (optional)

MealPreference (default preferences):
  - user (FK)
  - day_of_week (Mon-Thu)
  - adults_count
  - children_count
  - prefers_meat (for Wednesday)

MealRegistration (actual registrations per day):
  - user (FK)
  - date
  - adults_count
  - children_count
  - meal_type (meat/vegetarian, for Wednesday)
  - is_active

FoodTicket:
  - owner (FK to User)
  - date
  - adults_count
  - children_count
  - meal_type
  - price (decimal, nullable - null means free)
  - description (optional note from seller)
  - is_available (boolean)
  - claimed_by (FK to User, nullable)
  - claimed_at (nullable)
  - created_at
  # Note: Seller's phone number accessed via owner.phone_number

# DEFERRED: Cooking duties (Phase 2)
# CookingDuty:
#   - user (FK)
#   - date
#   - is_completed
#   - wants_to_trade
#   - trade_notes
```

### Calendar App
```python
Event:
  - title
  - description
  - created_by (FK to User)
  - start_datetime
  - end_datetime
  - location (optional)
  - is_all_day
  - created_at
```

### Messaging App
```python
Conversation:
  - participants (M2M to User)
  - created_at
  - updated_at

Message:
  - conversation (FK)
  - sender (FK to User)
  - content
  - created_at
  - read_by (M2M to User)
```

### Notifications App
```python
NotificationPreference:
  - user (FK)
  - notify_forum_replies (boolean)
  - notify_announcements (boolean)
  - notify_food_updates (boolean)
  - notify_messages (boolean)
  - email_enabled (boolean)
  - push_enabled (boolean)

Notification:
  - user (FK)
  - type (enum)
  - title
  - message
  - link (optional)
  - is_read
  - created_at
```

---

## API Endpoints Structure

### Authentication
- `POST /api/auth/login/` - Login
- `POST /api/auth/logout/` - Logout
- `POST /api/auth/register/` - Register (with invitation token)
- `GET /api/auth/me/` - Current user

### Users
- `GET/PATCH /api/users/me/` - Current user profile
- `GET /api/users/` - List all users
- `GET /api/users/{id}/` - User detail
- `POST /api/users/invite/` - Create invitation

### Houses
- `GET /api/houses/` - List houses with inhabitants
- `GET /api/houses/{id}/` - House detail

### Forum
- `GET/POST /api/forum/subgroups/` - List/create subgroups
- `POST /api/forum/subgroups/{id}/subscribe/` - Subscribe to subgroup
- `POST /api/forum/subgroups/{id}/unsubscribe/` - Unsubscribe from subgroup
- `GET /api/forum/subscriptions/` - List user's subscribed subgroups
- `GET/POST /api/forum/subgroups/{id}/threads/` - Threads in subgroup
- `GET/POST /api/forum/threads/{id}/posts/` - Posts in thread
- `PATCH/DELETE /api/forum/posts/{id}/` - Edit/delete own post
- `GET/POST /api/forum/subgroups/{id}/folders/` - Folders
- `POST /api/forum/folders/{id}/files/` - Upload file
- `DELETE /api/forum/files/{id}/` - Delete file (owner only)

### Announcements
- `GET/POST /api/announcements/` - List/create announcements
- `GET/PATCH/DELETE /api/announcements/{id}/` - Detail

### Food
- `GET/POST /api/food/menus/` - Weekly menus
- `GET /api/food/menus/current/` - Current week's menu
- `GET/PATCH /api/food/preferences/` - User's default preferences
- `GET/POST/PATCH /api/food/registrations/` - Meal registrations
- `POST /api/food/registrations/apply-defaults/` - Apply default preferences to a week
- `GET/POST /api/food/tickets/` - Food tickets
- `POST /api/food/tickets/{id}/claim/` - Claim a ticket
- `POST /api/food/tickets/{id}/release/` - Release claimed ticket

### Calendar
- `GET/POST /api/calendar/events/` - List/create events
- `GET/PATCH/DELETE /api/calendar/events/{id}/` - Detail

### Messaging
- `GET/POST /api/messages/conversations/` - List/create conversations
- `GET /api/messages/conversations/{id}/` - Conversation with messages
- `POST /api/messages/conversations/{id}/send/` - Send message
- `POST /api/messages/conversations/{id}/read/` - Mark as read

### Notifications
- `GET /api/notifications/` - List notifications
- `GET/PATCH /api/notifications/preferences/` - Notification settings
- `POST /api/notifications/{id}/read/` - Mark as read

---

## Implementation Phases

### Phase 1: Project Setup & Core Infrastructure
1. Initialize Django project with apps structure
2. Set up Vite + React + Mantine + PWA
3. Configure Django REST Framework + CORS
4. Set up authentication (session + JWT via djangorestframework-simplejwt)
5. Create User model with profile fields
6. Implement invitation-only registration
7. Basic API client setup in frontend (axios + React Query)
8. PWA manifest and service worker setup

### Phase 2: Houses & User Profiles
1. House model and API
2. User profile pages
3. House directory page with inhabitants
4. Profile editing with picture upload (Mantine Dropzone)

### Phase 3: Forum System
1. Subgroup, Thread, Post models with subscriptions
2. Forum API endpoints
3. Forum UI (subgroup list, thread list, post list/create)
4. Subscription management (subscribe/unsubscribe to subgroups)
5. Auto-subscribe to default subgroups on registration
6. File/folder system for subgroups
7. Rich text editor for posts (Tiptap)

### Phase 4: Announcements (Important Posts)
1. Announcement model and API
2. Announcements displayed prominently on dashboard
3. Dedicated announcements page
4. Any user can create announcements (community trust model)

### Phase 5: Food Module (excluding cooking duties)
1. WeeklyMenu, DailyMenu, MealPreference, MealRegistration, FoodTicket models
2. Weekly menu display interface
3. Default preferences management (adults, children, meat preference)
4. Daily registration interface (Mon-Thu, meat/veg option on Wed)
5. Food ticket trading system (offer/claim tickets)

### Phase 6: Calendar
1. Event model and API
2. Calendar UI (using Mantine dates + custom views)
3. Event creation and editing
4. Dashboard widget showing upcoming events

### Phase 7: Messaging
1. Conversation and Message models
2. Django Channels setup for WebSockets
3. Real-time messaging UI (conversation list, chat interface)
4. Read receipts
5. Create conversations with one or more participants

### Phase 8: Notifications & PWA
1. Notification models and preferences
2. Email notifications (Django email backend)
3. Web Push notifications (pywebpush + service worker)
4. Notification center UI in header
5. Per-feature notification settings

### Phase 9: Polish & Testing
1. Mobile responsiveness review
2. Error handling and loading states
3. Form validation throughout
4. Basic test coverage
5. Documentation for deployment

### Future Phase: Cooking Duties (not in initial scope)
- Cooking duty assignment by admin
- Duty trading system
- Integration with food module

---

## Frontend Pages Structure

```
/                          - Dashboard (announcements, upcoming meals, events)
/login                     - Login page
/register?token=xxx        - Registration with invitation

/forum                     - Forum subgroups list
/forum/:subgroupId         - Threads in subgroup
/forum/:subgroupId/files   - Files/folders in subgroup
/forum/thread/:threadId    - Thread with posts

/announcements             - All announcements

/food                      - Food module dashboard (menu + registration)
/food/preferences          - Default preferences
/food/tickets              - Food ticket trading

/calendar                  - Community calendar

/messages                  - Message conversations
/messages/:conversationId  - Conversation view

/directory                 - Houses and inhabitants
/directory/house/:id       - House detail with inhabitants

/profile                   - Current user profile
/profile/edit              - Edit profile
/profile/:userId           - View other user's profile

/settings                  - User settings (notifications, etc.)
/admin/invitations         - Manage invitations (admin only)
```

---

## Key Technical Decisions

1. **State Management**: Zustand for global state (lightweight, simple)
2. **Data Fetching**: TanStack Query (React Query) for caching and server state
3. **Rich Text**: Tiptap editor (works well with Mantine)
4. **Real-time**: Django Channels + WebSocket for messaging
5. **Calendar**: FullCalendar or custom implementation with Mantine
6. **File Uploads**: Direct to backend, with progress tracking
7. **Notifications**: Web Push API + email fallback

---

## Key Dependencies (npm/pip packages)

### Backend (requirements.txt)
```
Django>=5.0
djangorestframework>=3.14
djangorestframework-simplejwt>=5.3
django-cors-headers>=4.3
Pillow>=10.0  # Image handling
channels>=4.0  # WebSockets (using InMemoryChannelLayer)
daphne>=4.0  # ASGI server for Channels
pywebpush>=1.14  # Web push notifications
python-dotenv>=1.0
```

### Frontend (package.json)
```json
{
  "dependencies": {
    "react": "^18.2",
    "react-dom": "^18.2",
    "react-router-dom": "^6.20",
    "@mantine/core": "^7.3",
    "@mantine/hooks": "^7.3",
    "@mantine/dates": "^7.3",
    "@mantine/dropzone": "^7.3",
    "@mantine/tiptap": "^7.3",
    "@tiptap/react": "^2.1",
    "@tiptap/starter-kit": "^2.1",
    "@tanstack/react-query": "^5.8",
    "axios": "^1.6",
    "dayjs": "^1.11",
    "zustand": "^4.4"
  },
  "devDependencies": {
    "vite": "^5.0",
    "vite-plugin-pwa": "^0.17",
    "@vitejs/plugin-react": "^4.2",
    "typescript": "^5.3"
  }
}
```

---

## Quick Start (First Implementation Steps)

When starting implementation, we'll begin with Phase 1:

1. **Create project structure:**
   ```
   mkdir -p backend frontend
   cd backend && django-admin startproject config .
   cd ../frontend && npm create vite@latest . -- --template react-ts
   ```

2. **Set up Django apps:** Create all apps under `backend/apps/`

3. **Configure settings:** CORS, JWT auth, static files, media files

4. **Set up frontend:** Install Mantine, React Router, React Query, configure PWA

5. **Create User model:** Extend AbstractUser with required fields

6. **Implement auth flow:** JWT login, invitation-based registration

This foundation enables all subsequent phases to build upon.
