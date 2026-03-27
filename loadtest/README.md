# Load Testing

Realistic load tests for KB Intra using [Locust](https://locust.io). Simulates up to 1000+ concurrent users browsing the forum, sending messages, reacting to posts, and triggering notifications — all through the real API.

## Quick Start (Dev)

Good for verifying the test works. Dev mode runs Huey tasks synchronously so write operations will be slow — use the Docker stack for realistic numbers.

```bash
# Terminal 1: start dev server
uv run dev.py

# Terminal 2: create test users + run
cd backend
uv run python manage.py shell < ../loadtest/setup_users.py

cd ../loadtest
export LOAD_TEST_USERS="loadtest1@test.com:loadtest123,loadtest2@test.com:loadtest123,loadtest3@test.com:loadtest123,loadtest4@test.com:loadtest123,loadtest5@test.com:loadtest123"
uv run --with locust locust
```

Open http://localhost:8089, set host to `http://localhost:7000`, and start.

## Prod-Like Setup (Docker Compose)

A compose overlay (`docker-compose.loadtest.yml`) layers on top of the local stack, adding a Huey worker and setting `DEBUG=False` for async task processing — matching production behavior.

**1. Build and start the stack:**

```bash
docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml up -d --build
```

This starts: Traefik (port 80) + Redis + Backend (`DEBUG=False`) + Huey worker + Frontend.

**2. Create test users** (note: use `-T` flag and pipe, not `<` redirect):

```bash
cat loadtest/setup_users.py | \
  docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml \
  exec -T backend uv run python manage.py shell
```

If you have a fresh database, also create some forum subgroups:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml \
  exec -T backend uv run python manage.py shell -c "
from apps.forum.models import Subgroup, SubgroupSubscription
from apps.users.models import User
for name, slug in [('Fælles','faelles'),('Arrangementer','arrangementer'),('Mad','mad'),('Vedligeholdelse','vedligeholdelse')]:
    Subgroup.objects.get_or_create(name=name, defaults={'slug': slug})
for u in User.objects.filter(email__startswith='loadtest'):
    for sg in Subgroup.objects.all():
        SubgroupSubscription.objects.get_or_create(user=u, subgroup=sg)
print('Done')
"
```

**3. Run locust (on the host):**

```bash
cd loadtest
export LOAD_TEST_USERS="loadtest1@test.com:loadtest123,loadtest2@test.com:loadtest123,loadtest3@test.com:loadtest123,loadtest4@test.com:loadtest123,loadtest5@test.com:loadtest123"
uv run --with locust locust
```

Open http://localhost:8089, set host to `http://localhost`, and start.

**4. Stop and clean up:**

```bash
docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml down
```

### Recommended test profiles

| Profile | Users | Ramp-up | Duration | What it tests |
|---|---|---|---|---|
| Smoke | 5 | 5/s | 1 min | Basic sanity |
| Normal load | 50 | 10/s | 5 min | Typical usage (~90 real users, not all active) |
| Peak load | 200 | 20/s | 5 min | Everyone online at once |
| Stress | 1000 | 50/s | 10 min | Find the breaking point |

## Headless Mode (CI / quick check)

```bash
cd loadtest
export LOAD_TEST_USERS="loadtest1@test.com:loadtest123,loadtest2@test.com:loadtest123,loadtest3@test.com:loadtest123,loadtest4@test.com:loadtest123,loadtest5@test.com:loadtest123"
uv run --with locust locust \
  --headless \
  -u 100 \
  -r 20 \
  --host http://localhost \
  --run-time 60s \
  --only-summary
```

## How It Scales to 1000 Users

1. **Shared token cache** — only 5 logins happen (one per credential), not 1000. All Locust users sharing a credential reuse the same JWT token.

2. **Shared data pool** — discovered IDs (threads, posts, conversations) are pooled across all users in a thread-safe store.

3. **Lazy discovery** — only the first user bootstraps. Others discover IDs naturally through read tasks.

### Account sharing side effects

Since 1000 Locust users share 5 accounts, some operations get 403/404 (ownership mismatches). These are expected and counted as successes — the server still does auth, routing, and permission checks, which is the load we're testing.

## What It Tests

### Read operations (browsing)

| Task | Weight | Description |
|---|---|---|
| `browse_forum_subgroups` | 10 | Forum landing page |
| `browse_threads` | 8 | Threads in a subgroup |
| `read_thread_posts` | 6 | Posts in a thread |
| `check_unread_counts` | 6 | Forum + messages + notifications |
| `view_users` | 5 | Resident directory |
| `view_current_user` | 4 | Own profile |
| `list_notifications` | 4 | Notification list |
| `browse_conversations` | 3 | Message conversations |
| `read_conversation_messages` | 3 | Messages in a conversation |
| `view_events` | 3 | Upcoming events |
| `view_food_registrations` | 3 | Meal registrations |
| `view_houses` | 3 | House directory |
| `view_announcements` | 2 | Announcements |
| `view_event_detail` | 2 | Single event page |
| `view_food_tickets` | 2 | Food tickets |
| `view_food_teams` | 2 | Cooking teams |
| `search` | 1 | Full-text search |
| `view_recent_forum_activity` | 1 | Recent forum activity |
| `view_subscriptions` | 1 | Forum subscriptions |
| `view_birthdays` | 1 | Upcoming birthdays |
| `view_bookings_calendar` | 1 | Room booking calendar |
| `view_links` | 1 | Useful links |
| `health_check` | 1 | Health endpoint |

### Write operations (triggers notifications)

| Task | Weight | Notifications triggered |
|---|---|---|
| `reply_to_thread` | 4 | Thread participants + mentioned users |
| `react_to_post` | 3 | Post author |
| `send_message` | 3 | Conversation participants |
| `create_forum_thread` | 2 | All subgroup subscribers |
| `react_to_message` | 2 | Message sender |
| `mark_messages_read` | 2 | Clears unreads |
| `mark_subgroup_read` | 2 | Clears unreads |
| `mark_notifications_read` | 2 | Clears unreads |
| `create_conversation` | 1 | New conversation partner |
| `rsvp_to_event` | 1 | Event organizer |
| `toggle_thread_mute` | 1 | Affects future notifications |
| `mark_all_forum_read` | 1 | Clears unreads |

## Cleanup

Remove all loadtest data:

```bash
# Dev
cd backend && uv run python manage.py shell < ../loadtest/cleanup.py

# Docker
cat loadtest/cleanup.py | \
  docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml \
  exec -T backend uv run python manage.py shell
```

## Files

```
loadtest/
├── README.md                       # This file
├── locustfile.py                   # Locust test scenarios
├── setup_users.py                  # Create test users (manage.py shell)
└── cleanup.py                      # Remove loadtest data (manage.py shell)
docker-compose.loadtest.yml         # Compose overlay (Huey + DEBUG=False)
```
