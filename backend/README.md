# KB Intra Backend

Django REST API backend for the KB Intra community platform.

## Tech Stack

- Django 5.x
- Django REST Framework
- Django Channels (WebSocket via Daphne)
- djangorestframework-simplejwt (JWT auth)
- Huey (background task queue, SQLite broker)
- Redis (Channels layer for WebSocket message routing)
- SQLite (database, suitable for ~90 users)
- pytest + pytest-django (testing)
- Ruff (linting/formatting) + ty (type checking)

## Project Structure

```
backend/
├── config/                     # Django project configuration
│   ├── settings.py             # Main settings
│   ├── urls.py                 # Root URL configuration
│   ├── asgi.py                 # ASGI config for WebSocket
│   └── wsgi.py                 # WSGI config
├── apps/
│   ├── users/                  # User management
│   ├── houses/                 # House directory
│   ├── forum/                  # Forum system
│   ├── announcements/          # Announcements
│   ├── food/                   # Food module
│   ├── calendar_app/           # Calendar events
│   ├── messaging/              # Direct messaging
│   └── notifications/          # Notifications (in-app, email, push)
├── docker-entrypoint.sh        # Container startup (migrations + Daphne)
├── Dockerfile
├── conftest.py                 # Pytest fixtures
├── manage.py
└── pyproject.toml              # Dependencies (uv)
```

## Running the Server

### Local development

```bash
# Install dependencies
uv sync

# Run migrations
uv run python manage.py migrate

# Run development server (HTTP only)
uv run python manage.py runserver

# Run with Daphne (WebSocket support)
uv run daphne -b 0.0.0.0 -p 7000 config.asgi:application
```

### Docker (production)

```bash
# From project root
docker compose up -d --build

# Or use the deploy script (pulls latest code first)
./deploy.sh
```

Migrations run automatically on container startup via `docker-entrypoint.sh`.

### Production architecture

```
Internet → Cloudflare Tunnel → Traefik → Backend (Daphne, port 8000)
                                       → Frontend (Nginx, port 80)
```

**Docker services:**

| Service | Role |
|---|---|
| `traefik` | Reverse proxy, routes `/api`, `/ws`, `/admin`, `/media`, `/static` to backend |
| `cloudflared` | Cloudflare Tunnel for secure ingress |
| `redis` | Channel layer backend for Django Channels (WebSocket routing) |
| `backend` | Daphne ASGI server handling HTTP + WebSocket |
| `huey` | Background task worker (emails, push notifications) |
| `frontend` | Nginx serving the React SPA |

**Daphne configuration** (via `docker-entrypoint.sh`):
- `--proxy-headers` — trusts `X-Forwarded-For`/`X-Forwarded-Proto` from Traefik
- `--ping-interval 20 --ping-timeout 30` — detects stale WebSocket connections
- `-v 1` — basic access logging

**Reliability:**
- Health checks on `redis` and `backend` (via `GET /api/health/`)
- Graceful shutdown with `SIGINT` + 30s grace period
- Memory limits on all containers
- SQLite write timeout of 20s to handle concurrent access from Daphne + Huey
- `restart: unless-stopped` on all services

## Database Models

### Users App (`apps/users/`)

**User** - Custom user model with email authentication
- `email` (unique) - Login identifier
- `first_name`, `last_name` - Display name
- `phone_number`, `birthdate`, `bio` - Profile info
- `profile_picture` - Avatar image
- `house` (FK) - Assigned house
- `is_over_50`, `can_be_head_chef` - Food team flags

**Invitation** - Invitation-only registration
- `email` - Invited email address
- `token` - Unique invitation token
- `house` (FK) - Pre-assigned house
- `created_by` (FK) - Who sent invitation
- `expires_at` - Expiration timestamp
- `used_at` - When used (null if unused)

### Houses App (`apps/houses/`)

**House** - Community houses
- `name` - House name/number
- `description` - About the house
- `address` - Physical address
- `profile_picture` - House image

### Forum App (`apps/forum/`)

**Subgroup** - Forum categories
- `name`, `description`, `slug`
- `is_default` - Auto-subscribe new users
- `is_committee` - Committee (udvalg) styling
- `last_activity_at` - For sorting
- Ordering: committees first, then by last activity

**SubgroupSubscription** - User subscriptions
- `user`, `subgroup` (unique together)
- `notify_new_threads`

**Thread** - Discussion threads
- `subgroup` (FK), `title`, `author` (FK)
- `is_pinned` - Sticky thread

**Post** - Thread replies
- `thread` (FK), `author` (FK)
- `content` - Rich text (HTML)

**Folder** - File organization
- `subgroup` (FK), `name`
- `parent` (FK, nullable) - For nesting

**File** - Uploaded files
- `folder` (FK, nullable) - Root level if null
- `subgroup` (FK) - Direct subgroup reference
- `name`, `file`, `uploaded_by`

### Announcements App (`apps/announcements/`)

**Announcement** - Community announcements
- `title`, `content` (HTML)
- `author` (FK), `is_active`, `priority`

### Food App (`apps/food/`)

**MenuTemplate** - Reusable menu items
- `name`, `description`
- `has_meat_option`, `meat_description`, `vegetarian_description`

**WeeklyMenu** - Weekly menu container
- `week_start_date` (Monday)
- `created_by` (FK)

**DailyMenu** - Daily menu (Mon-Thu)
- `weekly_menu` (FK), `date`, `day_of_week`
- `template` (FK, nullable)
- `has_meat_option` - Wednesday only

**MealPreference** - Default preferences per weekday
- `user` (FK), `day_of_week`
- `adults_count`, `children_count`
- `prefers_meat`, `dining_option`, `seating_time`

**MealRegistration** - Actual meal sign-ups
- `user` (FK), `date`
- `adults_count`, `children_count`
- `meal_type` - meat/vegetarian
- `dining_option` - eat_in/take_away
- `seating_time` - 17:30/18:30 (eat-in only)
- `is_active` - Soft delete

**FoodTicket** - Tradeable meal spots
- `owner` (FK), `date`
- `adults_count`, `children_count`
- `meal_type`, `price` (nullable = free)
- `is_available`, `claimed_by`, `claimed_at`

**FoodTeamCycle** - Team rotation period
- `name`, `start_date`, `end_date`
- `wish_deadline`, `status` (draft/collecting_wishes/generating/finalized)
- `created_by` (FK)

**FoodTeamWish** - User availability for cooking
- `cycle` (FK), `user` (FK)
- `available_dates` (JSON list)
- `comment`

**FoodTeam** - Cooking team for a date
- `cycle` (FK), `date`, `notes`

**FoodTeamMember** - Team membership
- `team` (FK), `user` (FK)
- `house_number` - Display value

**TeamSwapRequest** - Swap team dates
- `requester` (FK)
- `requester_membership`, `target_membership` (FKs)
- `status` - pending/accepted/declined/cancelled
- `message`, `response_message`

### Calendar App (`apps/calendar_app/`)

**Event** - Calendar events
- `title`, `description`
- `created_by` (FK)
- `start_datetime`, `end_datetime`
- `location`, `is_all_day`

### Messaging App (`apps/messaging/`)

**Conversation** - Chat conversations
- `participants` (M2M to User)
- Supports 1-on-1 and group chats

**Message** - Chat messages
- `conversation` (FK), `sender` (FK)
- `content`, `is_read`

### Notifications App (`apps/notifications/`)

**Notification** - User notifications
- `user` (FK), `notification_type`
- `title`, `message`, `link`
- `is_read`, `related_user` (FK, nullable)

**NotificationPreference** - Per-user settings
- `user` (OneToOne)
- `notify_*` - In-app toggles
- `email_*` - Email toggles
- `push_*` - Push notification toggles

**PushSubscription** - Web Push subscriptions
- `user` (FK) - User who subscribed
- `endpoint` - Push service endpoint URL
- `p256dh_key` - Public encryption key
- `auth_key` - Authentication secret
- `user_agent` - Browser/device identifier

## API Endpoints

### Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health/` | Unauthenticated health check (used by Docker/Traefik) |

### Authentication (`/api/auth/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/token/` | Get JWT tokens (login) |
| POST | `/token/refresh/` | Refresh access token |
| POST | `/register/` | Register with invitation |
| POST | `/validate-invitation/` | Check invitation token |
| POST | `/invitations/` | Create invitation (auth required) |

### Users (`/api/users/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/me/` | Current user profile |
| PATCH | `/me/` | Update profile |
| GET | `/` | List all users |
| GET | `/{id}/` | User detail |

### Houses (`/api/houses/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List houses |
| GET | `/{id}/` | House detail with inhabitants |

### Forum (`/api/forum/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/subgroups/` | List subgroups |
| GET | `/subgroups/{slug}/` | Subgroup detail |
| POST | `/subgroups/{slug}/subscribe/` | Subscribe |
| POST | `/subgroups/{slug}/unsubscribe/` | Unsubscribe |
| GET | `/subscriptions/` | User's subscriptions |
| GET | `/subgroups/{slug}/threads/` | List threads |
| POST | `/subgroups/{slug}/threads/` | Create thread |
| GET | `/threads/{id}/` | Thread with posts |
| DELETE | `/threads/{id}/delete/` | Delete thread (owner) |
| GET | `/threads/{id}/posts/` | List posts |
| POST | `/threads/{id}/posts/` | Create post |
| PATCH | `/posts/{id}/` | Update post (owner) |
| DELETE | `/posts/{id}/` | Delete post (owner) |
| GET | `/subgroups/{slug}/folders/` | List folders |
| POST | `/subgroups/{slug}/folders/` | Create folder |
| GET | `/subgroups/{slug}/files/` | List root files |
| POST | `/subgroups/{slug}/files/` | Upload root file |
| GET | `/folders/{id}/` | Folder detail |
| GET | `/folders/{id}/files/` | Files in folder |
| POST | `/folders/{id}/files/` | Upload file to folder |
| DELETE | `/files/{id}/` | Delete file (owner) |
| PATCH | `/files/{id}/move/` | Move file (owner/admin) |

### Announcements (`/api/announcements/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List announcements |
| POST | `/` | Create announcement (admin) |
| GET | `/{id}/` | Announcement detail |
| PATCH | `/{id}/` | Update (owner) |
| DELETE | `/{id}/` | Delete (owner) |

### Food (`/api/food/`)

**Menus:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/menus/templates/` | List menu templates |
| POST | `/menus/templates/` | Create template (admin) |
| GET | `/menus/weekly/` | Current week menu |
| GET | `/menus/weekly/{date}/` | Specific week menu |
| PATCH | `/menus/daily/{id}/` | Update daily menu (admin) |

**Registrations:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/registrations/` | User's registrations |
| POST | `/registrations/` | Create registration |
| GET | `/registrations/{date}/` | Get by date |
| PATCH | `/registrations/{id}/` | Update registration |
| DELETE | `/registrations/{id}/` | Cancel registration |
| GET | `/registrations/stats/` | Weekly stats |

**Preferences:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/preferences/` | User's preferences |
| POST | `/preferences/` | Set preference |
| DELETE | `/preferences/{day}/` | Remove preference |

**Tickets:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tickets/` | Available tickets |
| POST | `/tickets/` | Create ticket |
| GET | `/tickets/my/` | User's tickets |
| POST | `/tickets/{id}/claim/` | Claim ticket |
| POST | `/tickets/{id}/release/` | Release claimed |
| DELETE | `/tickets/{id}/` | Delete ticket (owner) |

**Teams:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/teams/` | List teams |
| GET | `/teams/my/` | User's teams |
| GET | `/teams/{id}/` | Team detail |
| GET | `/teams/swaps/` | Swap requests |
| POST | `/teams/swaps/` | Create swap request |
| POST | `/teams/swaps/{id}/respond/` | Accept/decline |
| POST | `/teams/swaps/{id}/cancel/` | Cancel request |

**Cycles:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cycles/` | List cycles |
| GET | `/cycles/current/` | Active cycle |
| POST | `/cycles/` | Create cycle (admin) |
| GET | `/cycles/{id}/` | Cycle detail |
| PATCH | `/cycles/{id}/` | Update cycle (admin) |
| POST | `/cycles/{id}/start-collecting/` | Open wishes |
| POST | `/cycles/{id}/generate-teams/` | Generate teams |
| POST | `/cycles/{id}/finalize/` | Finalize cycle |
| GET | `/cycles/{id}/wishes/` | Cycle wishes |
| POST | `/cycles/{id}/wishes/` | Submit wish |

### Calendar (`/api/calendar/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events/` | List events (filterable) |
| POST | `/events/` | Create event |
| GET | `/events/upcoming/` | Dashboard widget |
| GET | `/events/{id}/` | Event detail |
| PATCH | `/events/{id}/` | Update (owner) |
| DELETE | `/events/{id}/` | Delete (owner) |

### Messaging (`/api/messages/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations/` | List conversations |
| POST | `/conversations/` | Create conversation |
| GET | `/conversations/{id}/` | Conversation + messages |
| GET | `/conversations/{id}/messages/` | List messages |
| POST | `/conversations/{id}/messages/` | Send message |
| POST | `/conversations/{id}/read/` | Mark as read |
| GET | `/unread-count/` | Total unread count |

### Notifications (`/api/notifications/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List notifications |
| GET | `/{id}/` | Notification detail |
| DELETE | `/{id}/` | Delete notification |
| POST | `/mark-read/` | Mark as read |
| GET | `/unread-count/` | Unread count |
| DELETE | `/clear-all/` | Delete all |
| GET | `/preferences/` | Get preferences |
| PATCH | `/preferences/` | Update preferences |
| GET | `/push/vapid-key/` | Get VAPID public key |
| POST | `/push/subscribe/` | Subscribe to push notifications |
| DELETE | `/push/subscribe/` | Unsubscribe from push |

### WebSocket

Connect to `ws://localhost:7000/ws/chat/?token=<jwt>` for real-time:
- New messages
- Typing indicators
- Read receipts
- New notifications

## Code Quality

```bash
# Linting
uv run ruff check .

# Formatting
uv run ruff format .

# Type checking
uvx ty check
```

## Testing

```bash
# Run all tests
uv run pytest

# Run with verbose output
uv run pytest -v

# Run specific app
uv run pytest apps/forum/tests.py
uv run pytest apps/food/tests.py

# Run with coverage
uv run pytest --cov=apps --cov-report=html
```

## Required Checks

Before committing, ensure all checks pass:

```bash
uv run ruff check .   # Linting
uv run ruff format .  # Formatting
uvx ty check          # Type checking
uv run pytest         # Tests
```

### Test Fixtures (conftest.py)

Common fixtures available:
- `api_client` - DRF test client
- `user`, `admin_user`, `second_user` - Test users
- `authenticated_client`, `admin_client` - Authenticated clients
- `house`, `house2` - Test houses
- `subgroup`, `committee_subgroup` - Forum groups
- `thread`, `post` - Forum content
- `folder`, `subfolder` - File folders
- `weekly_menu`, `meal_registration` - Food data
- `food_team_cycle`, `food_team` - Team data

## Push Notifications

The application supports Web Push notifications, allowing users to receive notifications even when the browser is closed.

### How It Works

1. **Frontend subscribes**: When a user enables push notifications, the browser generates a push subscription with a unique endpoint and encryption keys.

2. **Subscription stored**: The subscription is sent to the backend and stored in the `PushSubscription` model.

3. **Notification triggered**: When a notification event occurs (new message, announcement, etc.), the backend:
   - Creates an in-app notification
   - Sends an email (if enabled)
   - Sends a push notification using `pywebpush` (if enabled)

4. **Push delivered**: The push service (FCM, Mozilla, Apple) delivers the notification to the user's device.

5. **Service worker handles**: The frontend service worker receives the push event and displays a system notification.

### Configuration

Push notifications require VAPID (Voluntary Application Server Identification) keys. Generate them once and add to your environment:

```bash
# Generate VAPID keys (run once, requires Node.js)
npx web-push generate-vapid-keys
```

Add to your `.env` file:

```bash
# Web Push (VAPID) Configuration
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_ADMIN_EMAIL=admin@yourdomain.com
```

### Settings Reference

In `config/settings.py`:

```python
# Web Push settings
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_ADMIN_EMAIL = os.getenv("VAPID_ADMIN_EMAIL", "admin@example.com")

# VAPID claims for pywebpush
VAPID_CLAIMS = {"sub": f"mailto:{VAPID_ADMIN_EMAIL}"} if VAPID_PRIVATE_KEY else None
```

### User Preferences

Users can control push notifications per notification type:

- `push_messages` - Direct messages
- `push_announcements` - Community announcements
- `push_forum_subscriptions` - New threads in subscribed groups
- `push_thread_replies` - Replies to user's threads
- `push_event_reminders` - Calendar event reminders
- `push_food_tickets` - Food ticket availability

### Testing Push Notifications

1. Start the backend with VAPID keys configured
2. Open the frontend and go to Notifications > Settings > Push
3. Click "Enable push notifications" and allow the browser permission
4. Trigger a notification (e.g., send yourself a message from another account)
5. You should receive a system notification

### Troubleshooting

- **No VAPID keys**: Push notifications are silently disabled if keys aren't configured
- **Permission denied**: User must allow notifications in browser settings
- **Expired subscriptions**: Automatically cleaned up when push delivery fails with 404/410

## Key Files

- `config/settings.py` - Django settings (JWT, CORS, Channels, Huey, Redis)
- `config/urls.py` - API URL routing (includes `/api/health/`)
- `config/asgi.py` - ASGI config with WebSocket routing
- `docker-entrypoint.sh` - Container startup script (migrations + Daphne)
- `conftest.py` - Shared pytest fixtures
- `apps/*/models.py` - Database models
- `apps/*/serializers.py` - DRF serializers
- `apps/*/views.py` - API views
- `apps/*/urls.py` - App URL patterns
- `apps/*/admin.py` - Admin configuration
- `apps/notifications/services.py` - Notification creation + push sending
- `apps/notifications/tasks.py` - Huey background tasks (email, push)
- `apps/notifications/email_service.py` - Email rendering
- `apps/messaging/consumers.py` - WebSocket consumer
