"""
Load test for KB Intra.

Usage:
    cd loadtest
    uv run --with locust locust

Then open http://localhost:8089 and set host to your target.

Scales to 1000+ simulated users by sharing JWT tokens across Locust users
(one login per credential, no throttle issues) and using lazy data discovery
instead of per-user bootstrap storms.

Environment variables:
    LOAD_TEST_USERS  - comma-separated email:password pairs
                       e.g. "a@test.com:pass1,b@test.com:pass2"
                       (default: single user test@example.com:testpassword)

Setup helper — create test users on the backend:
    cd backend
    uv run python manage.py shell < ../loadtest/setup_users.py
"""

from __future__ import annotations

import os
import random
import threading
import time
from datetime import date, timedelta

from locust import HttpUser, between, task

# ── Parse user credentials ───────────────────────────────────────────

_raw = os.environ.get("LOAD_TEST_USERS", "test@example.com:testpassword")
USER_CREDENTIALS: list[tuple[str, str]] = []
for pair in _raw.split(","):
    pair = pair.strip()
    if ":" in pair:
        email, password = pair.split(":", 1)
        USER_CREDENTIALS.append((email.strip(), password.strip()))

_user_index = 0
_user_index_lock = threading.Lock()


def _next_credential_index() -> int:
    global _user_index
    with _user_index_lock:
        idx = _user_index % len(USER_CREDENTIALS)
        _user_index += 1
        return idx


# ── Shared token cache ───────────────────────────────────────────────
# Avoids hitting the 5 req/min login throttle when scaling to 1000 users.
# Only one Locust greenlet per credential actually logs in; others reuse
# the token.

_token_cache: dict[int, dict[str, str]] = {}  # cred_index -> {access, refresh}
_token_locks: dict[int, threading.Lock] = {}
_token_meta_lock = threading.Lock()


def _get_token_lock(cred_idx: int) -> threading.Lock:
    with _token_meta_lock:
        if cred_idx not in _token_locks:
            _token_locks[cred_idx] = threading.Lock()
        return _token_locks[cred_idx]


# ── Shared data pool ────────────────────────────────────────────────
# Lazily discovered IDs/slugs shared across all Locust users.
# Avoids the "bootstrap storm" of 1000 users each fetching 7 endpoints
# at startup.

_shared_lock = threading.Lock()
_shared: dict[str, list] = {
    "subgroup_slugs": [],
    "thread_ids": [],
    "post_ids": [],
    "conversation_ids": [],
    "event_slugs": [],
    "all_user_ids": [],
    "message_ids": [],
}


def _shared_extend(key: str, values: list, max_size: int = 500) -> None:
    if not values:
        return
    with _shared_lock:
        lst = _shared[key]
        lst.extend(values)
        if len(lst) > max_size:
            del lst[: len(lst) - max_size // 2]


def _shared_set(key: str, values: list) -> None:
    with _shared_lock:
        _shared[key] = list(values)


def _shared_get(key: str) -> list:
    with _shared_lock:
        return list(_shared[key])


def _shared_pick(key: str) -> object | None:
    with _shared_lock:
        lst = _shared[key]
        return random.choice(lst) if lst else None


# ── Constants ────────────────────────────────────────────────────────

REACTION_TYPES = ["like", "heart", "laugh", "surprised", "sad", "celebrate", "claim"]

THREAD_TITLES = [
    "Loadtest: Forslag til fællesspisning",
    "Loadtest: Ny regel for affaldssortering",
    "Loadtest: Sommerfest planlægning",
    "Loadtest: Rengøringsplan for fællesarealer",
    "Loadtest: Forslag til haveprojekt",
    "Loadtest: Cykelskur vedligeholdelse",
]

POST_CONTENTS = [
    "<p>Det lyder som en god idé! Jeg er med.</p>",
    "<p>Hvad synes I andre? Vi bør snakke om det til næste møde.</p>",
    "<p>Jeg har et forslag: vi kunne prøve en ny tilgang denne gang.</p>",
    "<p>Enig! Lad os få det gjort inden weekenden.</p>",
    "<p>Tak for input. Jeg opdaterer planen.</p>",
    "<p>Godt punkt. Har vi nogen der kan stå for det?</p>",
]

MESSAGE_CONTENTS = [
    "Hej! Har du set opslaget om fællesspisning?",
    "Kan du hjælpe med rengøringen i morgen?",
    "Skal vi snakke om det til næste møde?",
    "Tak for hjælpen i går!",
    "Husk at melde dig til middagen.",
    "Jeg kommer lidt senere i dag.",
]


class KBIntraUser(HttpUser):
    """Simulates a realistic KB Intra user.

    Scales to 1000+ users by:
    - Sharing JWT tokens (one login per credential, not per Locust user)
    - Sharing discovered IDs/slugs across all users (thread-safe pool)
    - Lazy data discovery instead of per-user bootstrap
    """

    wait_time = between(2, 6)

    def on_start(self) -> None:
        self.cred_idx = _next_credential_index()
        self.my_user_id: int | None = None
        self._ensure_token()
        # Only the first user per credential bootstraps shared data
        if not _shared_get("subgroup_slugs"):
            self._bootstrap()

    # ── Auth ─────────────────────────────────────────────────────────

    def _ensure_token(self) -> None:
        """Get a token — from cache if another user already logged in with
        this credential, otherwise log in (once, protected by a lock)."""
        if self.cred_idx in _token_cache:
            return

        lock = _get_token_lock(self.cred_idx)
        with lock:
            # Double-check after acquiring lock
            if self.cred_idx in _token_cache:
                return
            self._do_login()

    def _do_login(self) -> None:
        email, password = USER_CREDENTIALS[self.cred_idx]
        for attempt in range(3):
            with self.client.post(
                "/api/auth/token/",
                json={"email": email, "password": password},
                catch_response=True,
            ) as resp:
                if resp.status_code == 200:
                    data = resp.json()
                    _token_cache[self.cred_idx] = {
                        "access": data["access"],
                        "refresh": data["refresh"],
                    }
                    resp.success()
                    return
                if resp.status_code == 429:
                    resp.success()
                    time.sleep(12 + random.uniform(0, 3))
                    continue
                resp.failure(f"Login failed ({email}): {resp.status_code}")
                return

    def _refresh_token(self) -> None:
        tokens = _token_cache.get(self.cred_idx)
        if not tokens:
            return
        lock = _get_token_lock(self.cred_idx)
        with lock:
            with self.client.post(
                "/api/auth/token/refresh/",
                json={"refresh": tokens["refresh"]},
                catch_response=True,
            ) as resp:
                if resp.status_code == 200:
                    data = resp.json()
                    _token_cache[self.cred_idx] = {
                        "access": data["access"],
                        "refresh": data.get("refresh", tokens["refresh"]),
                    }
                    resp.success()
                else:
                    # Token expired beyond refresh — re-login
                    resp.success()
                    self._do_login()

    @property
    def auth_headers(self) -> dict[str, str]:
        tokens = _token_cache.get(self.cred_idx)
        if tokens:
            return {"Authorization": f"Bearer {tokens['access']}"}
        return {}

    # ── HTTP helpers ─────────────────────────────────────────────────

    def _get(self, path: str, name: str | None = None) -> dict | list | None:
        with self.client.get(
            path, headers=self.auth_headers, name=name or path, catch_response=True
        ) as resp:
            if resp.status_code == 200:
                resp.success()
                return resp.json()
            if resp.status_code == 401:
                resp.failure("401 Unauthorized")
                self._refresh_token()
            elif resp.status_code in (403, 404):
                # Expected when sharing accounts — permission/ownership mismatches
                resp.success()
            else:
                resp.failure(f"{resp.status_code}")
            return None

    def _post(
        self, path: str, json: dict | None = None, name: str | None = None
    ) -> dict | list | None:
        with self.client.post(
            path,
            json=json,
            headers=self.auth_headers,
            name=name or path,
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 201):
                resp.success()
                try:
                    return resp.json()
                except Exception:
                    return {}
            if resp.status_code == 401:
                resp.failure("401 Unauthorized")
                self._refresh_token()
            elif resp.status_code in (400, 403, 404):
                # 400: validation rejections (expected)
                # 403/404: ownership mismatches from shared accounts (expected)
                resp.success()
            else:
                resp.failure(f"{resp.status_code}")
            return None

    # ── Bootstrap (runs once, populates shared pool) ─────────────────

    def _bootstrap(self) -> None:
        me = self._get("/api/users/me/")
        if me and isinstance(me, dict):
            self.my_user_id = me.get("id")

        users = self._get("/api/users/")
        if users and isinstance(users, list):
            _shared_set("all_user_ids", [u["id"] for u in users if "id" in u])

        subgroups = self._get("/api/forum/subgroups/")
        if subgroups and isinstance(subgroups, list):
            _shared_set("subgroup_slugs", [s["slug"] for s in subgroups if "slug" in s])

        convos = self._get("/api/messages/conversations/")
        if convos and isinstance(convos, list):
            _shared_set("conversation_ids", [c["id"] for c in convos if "id" in c])

        ev = self._get("/api/events/upcoming/")
        if ev and isinstance(ev, list):
            _shared_set("event_slugs", [e["slug"] for e in ev if "slug" in e])

        slugs = _shared_get("subgroup_slugs")
        if slugs:
            threads = self._get(
                f"/api/forum/subgroups/{slugs[0]}/threads/",
                name="/api/forum/subgroups/[slug]/threads/",
            )
            if threads and isinstance(threads, list):
                _shared_extend("thread_ids", [t["id"] for t in threads if "id" in t])

        tids = _shared_get("thread_ids")
        if tids:
            posts = self._get(
                f"/api/forum/threads/{tids[0]}/posts/",
                name="/api/forum/threads/[id]/posts/",
            )
            if posts and isinstance(posts, list):
                _shared_extend("post_ids", [p["id"] for p in posts if "id" in p])

    # ═══════════════════════════════════════════════════════════════════
    #  READ tasks (browsing)
    # ═══════════════════════════════════════════════════════════════════

    @task(10)
    def browse_forum_subgroups(self) -> None:
        data = self._get("/api/forum/subgroups/")
        if data and isinstance(data, list):
            _shared_set("subgroup_slugs", [s["slug"] for s in data if "slug" in s])

    @task(8)
    def browse_threads(self) -> None:
        slug = _shared_pick("subgroup_slugs")
        if not slug:
            return
        data = self._get(
            f"/api/forum/subgroups/{slug}/threads/",
            name="/api/forum/subgroups/[slug]/threads/",
        )
        if data and isinstance(data, list):
            _shared_extend("thread_ids", [t["id"] for t in data if "id" in t])

    @task(6)
    def read_thread_posts(self) -> None:
        thread_id = _shared_pick("thread_ids")
        if not thread_id:
            return
        data = self._get(
            f"/api/forum/threads/{thread_id}/posts/",
            name="/api/forum/threads/[id]/posts/",
        )
        if data and isinstance(data, list):
            _shared_extend("post_ids", [p["id"] for p in data if "id" in p])

    @task(6)
    def check_unread_counts(self) -> None:
        self._get("/api/forum/unread-count/")
        self._get("/api/messages/unread-count/")
        self._get("/api/notifications/unread-count/")

    @task(5)
    def view_users(self) -> None:
        data = self._get("/api/users/")
        if data and isinstance(data, list):
            _shared_set("all_user_ids", [u["id"] for u in data if "id" in u])

    @task(4)
    def view_current_user(self) -> None:
        me = self._get("/api/users/me/")
        if me and isinstance(me, dict) and not self.my_user_id:
            self.my_user_id = me.get("id")

    @task(4)
    def list_notifications(self) -> None:
        self._get("/api/notifications/")

    @task(3)
    def browse_conversations(self) -> None:
        data = self._get("/api/messages/conversations/")
        if data and isinstance(data, list):
            _shared_extend("conversation_ids", [c["id"] for c in data if "id" in c])

    @task(3)
    def read_conversation_messages(self) -> None:
        conv_id = _shared_pick("conversation_ids")
        if not conv_id:
            return
        data = self._get(
            f"/api/messages/conversations/{conv_id}/messages/",
            name="/api/messages/conversations/[id]/messages/",
        )
        if data and isinstance(data, list):
            _shared_extend("message_ids", [m["id"] for m in data if "id" in m])

    @task(3)
    def view_events(self) -> None:
        data = self._get("/api/events/upcoming/")
        if data and isinstance(data, list):
            _shared_set("event_slugs", [e["slug"] for e in data if "slug" in e])

    @task(2)
    def view_event_detail(self) -> None:
        slug = _shared_pick("event_slugs")
        if not slug:
            return
        self._get(f"/api/events/{slug}/", name="/api/events/[slug]/")

    @task(3)
    def view_food_registrations(self) -> None:
        self._get("/api/food/registrations/")

    @task(2)
    def view_food_tickets(self) -> None:
        self._get("/api/food/tickets/my/")

    @task(2)
    def view_food_teams(self) -> None:
        self._get("/api/food/teams/my/")

    @task(3)
    def view_houses(self) -> None:
        self._get("/api/houses/")

    @task(2)
    def view_announcements(self) -> None:
        self._get("/api/announcements/")

    @task(1)
    def view_recent_forum_activity(self) -> None:
        self._get("/api/forum/recent/")

    @task(1)
    def view_subscriptions(self) -> None:
        self._get("/api/forum/subscriptions/")

    @task(1)
    def search(self) -> None:
        queries = ["mad", "møde", "fest", "rengøring", "hus", "uge", "fælles"]
        q = random.choice(queries)
        self._get(f"/api/search/?q={q}", name="/api/search/?q=[query]")

    @task(1)
    def view_birthdays(self) -> None:
        self._get("/api/users/birthdays/")

    @task(1)
    def view_bookings_calendar(self) -> None:
        today = date.today()
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=28)
        self._get(
            f"/api/bookings/calendar/?start={start}&end={end}",
            name="/api/bookings/calendar/",
        )

    @task(1)
    def view_links(self) -> None:
        self._get("/api/links/")

    @task(1)
    def health_check(self) -> None:
        self.client.get("/api/health/")

    # ═══════════════════════════════════════════════════════════════════
    #  WRITE tasks (creates notifications, realistic mutations)
    # ═══════════════════════════════════════════════════════════════════

    @task(2)
    def create_forum_thread(self) -> None:
        slug = _shared_pick("subgroup_slugs")
        if not slug:
            return
        ts = int(time.time())
        data = self._post(
            f"/api/forum/subgroups/{slug}/threads/",
            json={
                "title": f"{random.choice(THREAD_TITLES)} ({ts})",
                "content": random.choice(POST_CONTENTS),
            },
            name="/api/forum/subgroups/[slug]/threads/ [POST]",
        )
        if data and isinstance(data, dict) and "id" in data:
            _shared_extend("thread_ids", [data["id"]])

    @task(4)
    def reply_to_thread(self) -> None:
        thread_id = _shared_pick("thread_ids")
        if not thread_id:
            return
        data = self._post(
            f"/api/forum/threads/{thread_id}/posts/",
            json={"content": random.choice(POST_CONTENTS)},
            name="/api/forum/threads/[id]/posts/ [POST]",
        )
        if data and isinstance(data, dict) and "id" in data:
            _shared_extend("post_ids", [data["id"]])

    @task(3)
    def react_to_post(self) -> None:
        post_id = _shared_pick("post_ids")
        if not post_id:
            return
        self._post(
            f"/api/forum/posts/{post_id}/react/",
            json={"reaction_type": random.choice(REACTION_TYPES)},
            name="/api/forum/posts/[id]/react/",
        )

    @task(2)
    def mark_subgroup_read(self) -> None:
        slug = _shared_pick("subgroup_slugs")
        if not slug:
            return
        self._post(
            f"/api/forum/subgroups/{slug}/mark-read/",
            name="/api/forum/subgroups/[slug]/mark-read/",
        )

    @task(3)
    def send_message(self) -> None:
        conv_id = _shared_pick("conversation_ids")
        if not conv_id:
            return
        self._post(
            f"/api/messages/conversations/{conv_id}/messages/",
            json={"content": random.choice(MESSAGE_CONTENTS)},
            name="/api/messages/conversations/[id]/messages/ [POST]",
        )

    @task(1)
    def create_conversation(self) -> None:
        all_ids = _shared_get("all_user_ids")
        others = [uid for uid in all_ids if uid != self.my_user_id]
        if not others:
            return
        recipient = random.choice(others)
        data = self._post(
            "/api/messages/conversations/",
            json={
                "participant_ids": [recipient],
                "initial_message": random.choice(MESSAGE_CONTENTS),
            },
            name="/api/messages/conversations/ [POST]",
        )
        if data and isinstance(data, dict) and "id" in data:
            _shared_extend("conversation_ids", [data["id"]])

    @task(2)
    def react_to_message(self) -> None:
        msg_id = _shared_pick("message_ids")
        if not msg_id:
            return
        self._post(
            f"/api/messages/messages/{msg_id}/react/",
            json={"reaction_type": random.choice(REACTION_TYPES)},
            name="/api/messages/messages/[id]/react/",
        )

    @task(2)
    def mark_messages_read(self) -> None:
        conv_id = _shared_pick("conversation_ids")
        if not conv_id:
            return
        self._post(
            f"/api/messages/conversations/{conv_id}/read/",
            name="/api/messages/conversations/[id]/read/",
        )

    @task(2)
    def mark_notifications_read(self) -> None:
        self._post("/api/notifications/mark-read/", json={})

    @task(1)
    def rsvp_to_event(self) -> None:
        slug = _shared_pick("event_slugs")
        if not slug or not self.my_user_id:
            return
        status = random.choice(["attending", "not_attending"])
        with self.client.patch(
            f"/api/events/{slug}/rsvp/",
            json={"attendances": [{"user_id": self.my_user_id, "status": status}]},
            headers=self.auth_headers,
            name="/api/events/[slug]/rsvp/",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 201, 400, 403, 404):
                resp.success()
            elif resp.status_code == 401:
                resp.failure("401")
                self._refresh_token()
            else:
                resp.failure(f"{resp.status_code}")

    @task(1)
    def toggle_thread_mute(self) -> None:
        thread_id = _shared_pick("thread_ids")
        if not thread_id:
            return
        self._post(
            f"/api/forum/threads/{thread_id}/mute/",
            name="/api/forum/threads/[id]/mute/",
        )

    @task(1)
    def mark_all_forum_read(self) -> None:
        self._post("/api/forum/mark-all-read/")
