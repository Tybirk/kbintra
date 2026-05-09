# Daphne Segfault — Investigation Notes

Backend has crashed 5 times between 2026-05-03 and 2026-05-08 with `exit status 139` (SIGSEGV). The container auto-recovers via `restart: unless-stopped`. Each restart causes a brief outage; the search-index rebuild now skips when the index is non-empty (`--if-empty`), so cold-restart downtime is shorter than it was originally.

**Current state (2026-05-09):** the NVX hypothesis below is invalidated. NVX has been off since 2026-05-07 (`HAS_NVX=True, USES_NVX=False` verified in the running container) but the backend crashed again on 2026-05-08. The fault-handler traceback puts the crash inside the **SQLite backend, in a thread spawned by asgiref's sync-in-async pool, wrapped by Sentry's `execute`/`connect` patches**. New leading suspect: **Sentry SDK 2.X profiler + threading integration** (multiple public reports of SIGSEGV under similar conditions).

## Crash signature

Four pre-fix crashes, two kernel-level patterns — same root cause:

| UTC timestamp        | Pattern | `ip` value                  | Notes |
|---|---|---|---|
| 2026-05-03 19:49:36  | A | `0x0000000000000001`         | Jumped to **address 0x1** (near-null function pointer) |
| 2026-05-06 18:20:16  | B | libpython base + **`0xeeecb`** | Jumped to libpython+0xeeecb (in `.rela.plt`, non-executable) |
| 2026-05-06 22:19:21  | A | `0x0000000000000019`         | Jumped to address 0x19 |
| 2026-05-07 10:30:57  | B | libpython base + **`0xeeecb`** | Same offset as crash #2 — deterministic |
| 2026-05-08 16:03:47  | — | (kernel ring buffer rotated) | `PYTHONFAULTHANDLER=1` finally produced a Python traceback — see below |

**What both pre-fix patterns mean:** the CPU was making an indirect call (e.g. `call *rax`) through a slot that should hold a function pointer. The slot held garbage. The fact that Pattern B lands at the *same offset* both times despite ASLR is decisive — it is the same corrupt value being interpreted as a function pointer, repeatedly. Most common source: a `tp_dealloc` slot or similar callback on a freed/reused PyObject.

This rules out random memory bugs and points to a **deterministic refcount/lifetime bug** in a C extension or async callback chain.

## 2026-05-08 traceback (decisive new evidence)

Frequency dropped after `AUTOBAHN_USE_NVX=0` (4-in-4-days → 1-in-2-days) but the bug is **not** fixed. `PYTHONFAULTHANDLER=1` dumped two thread stacks; abridged:

```
Fatal Python error: Segmentation fault

Thread A (most recent call first):
  django/db/backends/sqlite3/base.py:360 in execute
  django/db/backends/utils.py:{105,92,79} in _execute(_with_wrappers)
  sentry_sdk/integrations/django/__init__.py:645 in execute    ← Sentry cursor patch
  sentry_sdk/utils.py:1841 in runner
  django/db/models/sql/compiler.py:1623 in execute_sql
  django/db/models/sql/query.py:{626,644} in get_aggregation / get_count
  django/db/models/query.py:606 in count
  apps/forum/views.py:1637 in get                              ← ForumUnreadCountView
  rest_framework/views.py:512 in dispatch
  ...
  asgiref/sync.py:559 in thread_handler                        ← sync DRF view in async server
  ...
  sentry_sdk/integrations/threading.py:140 in run

Thread B (most recent call first):
  django/db/backends/sqlite3/base.py:215 in get_new_connection
  ...
  sentry_sdk/integrations/django/__init__.py:684 in connect    ← Sentry connect patch
  ...
  apps/forum/views.py:~1610-1640 in get                        ← second forum view, opening new SQLite conn
```

Two threads concurrently inside the SQLite backend; one mid-`execute()`, the other opening a new connection. Both go through Sentry's monkey-patched cursor wrappers and both run on `asgiref`'s sync-in-async thread pool. Note: `apps/forum/views.py:1637` is just `Thread.objects.filter(...).count()` — that's where one thread happened to be standing, not a smoking gun. Don't chase that view.

Log lines immediately before the crash show Litestream activity:

```
... level=INFO msg="compaction complete" system=store db=db.sqlite3 ...      (T-77s)
... level=INFO msg="replica sync"        system=store db=db.sqlite3 ...      (T-41s)
Fatal Python error: Segmentation fault                                       (T=0)
```

`backend/docker-entrypoint.sh:38` wraps Daphne with `litestream replicate -exec <daphne ...>`, so Litestream and Daphne are sibling processes sharing access to the WAL file. The `huey` container (same image, no Litestream wrapper, no Daphne) has not crashed once.

## Updated suspect ranking

1. **Sentry SDK 2.X profiler + threading** — `sentry_sdk/integrations/threading.py:140 in run` appears in the crashing traceback, and `profiles_sample_rate=0.1` is currently enabled (`backend/config/settings.py:391`). Multiple public reports of identical crash mode: SIGSEGV in long-running Django/Celery workers under `sentry-sdk` 2.X with profiling on (see references below). The profiler walks frames of running threads via signals — exactly the kind of operation that segfaults if a stack frame is freed mid-walk. **This is the cheapest experiment to try first.**
2. **Sentry's Django DB instrumentation** under multi-threaded sync-in-async — every `execute`/`connect` goes through `sentry_sdk.utils.runner` and the threading patches that bookend both threads in the traceback. Subset of #1; if disabling profiling alone doesn't help, drop the rest of the Django integration.
3. **Litestream + Django concurrent WAL access alongside `mmap_size=128MB`.** Litestream is meant to be safe, but the timing (replica sync ~40s before crash) and the fact that the no-Litestream `huey` container never crashes are suggestive. SQLite memory-maps the DB file (`PRAGMA mmap_size=134217728` in settings); concurrent file I/O against a memory-mapped region from a sibling process is a classic segfault recipe if any caching layer gets out of sync.
4. **CPython 3.11 `_sqlite3` extension under heavy concurrent multi-thread use** from the asgiref thread pool. Generic but plausible.
5. **Autobahn NVX** — demoted, effectively ruled out by the new traceback (crash is nowhere near WebSocket frame handling).

## Diagnostics

```bash
# 1. Confirm the crash signature at the kernel level
dmesg --time-format=iso | grep -i daphne
# Expect: daphne[<pid>]: segfault at <addr> ip <ip> ... in libpython3.11.so.1.0

# 2. Count restarts in the current log window
docker compose logs backend --since 24h | grep "exit status 139"

# 3. Rule out OOM (already confirmed: memory is fine)
free -h
docker stats kbintra-prod-backend-1 --no-stream

# 4. Health-check history (distinguishes startup-fail from persistent-fail)
docker inspect kbintra-prod-backend-1 --format='{{json .State.Health}}' | python3 -m json.tool

# 5. After PYTHONFAULTHANDLER=1: check container logs around crash for the Python traceback
#    (it dumps active threads' stacks to stderr on signal)
docker compose logs backend --since 24h | grep -B 2 -A 50 "Fatal Python error"
```

> ⚠️ Container recreation discards stdout history. If a crash is recent, do **not** redeploy before pulling the logs first — that's how we lost the pre-crash context on 2026-05-07.

## Actions taken

### 1. Autobahn 25.11.1 → 25.12.2 (2026-05-07, low confidence)

Upgraded the lock file and rebuilt:

```bash
docker exec kbintra-prod-backend-1 uv lock --upgrade-package autobahn
docker cp kbintra-prod-backend-1:/app/uv.lock backend/uv.lock
docker compose build backend && docker compose up -d backend
```

The 25.12.x changelogs are dominated by CI/build changes; only [autobahn#1767](https://github.com/crossbario/autobahn-python/issues/1767) (NVX runtime fallback consistency) is even tangentially relevant, and its stated failure mode is `ImportError`, not SIGSEGV. Treat as harmless but probably not the fix.

### 2. `PYTHONFAULTHANDLER=1` (preventive)

Added to `docker-compose.yml` for the `backend` service. On signal-based crashes, CPython now dumps a Python-level stack trace to stderr before the process dies, giving us a fighting chance at identifying the offending frame next time.

### 3. `rebuild_search_index --if-empty` (preventive)

Modified `docker-entrypoint.sh` to skip the search-index rebuild when the index is non-empty. Cuts cold-restart downtime substantially.

### 4. **`AUTOBAHN_USE_NVX=0` (2026-05-07, primary fix attempt)**

Added to `docker-compose.yml` for the `backend` service. Forces Autobahn to use pure-Python `Utf8Validator` and `XorMaskerSimple` instead of the native C extensions. Verified after restart:

```bash
docker exec kbintra-prod-backend-1 uv run python -c \
  "from autobahn.websocket import HAS_NVX, USES_NVX; print(HAS_NVX, USES_NVX)"
# Expected: True False  (built but disabled)
```

Performance impact for ~90 users is negligible. This is the variable to watch.

## Escalation plan (in cost order)

We are now on the "NVX disabled and it still crashes" branch. The next crash should refine which suspect is actually responsible — try the cheapest mitigation first and watch for recurrence.

**Always pull the pre-crash log first** (container recreation discards stdout history):
```bash
docker compose logs backend --since 24h > /tmp/pre-crash-backend.log
```

### Step 1 — turn off Sentry profiling (env-only, no code change)

Most likely fix and the cheapest to try. In `.env` on prod:

```
SENTRY_PROFILES_SAMPLE_RATE=0
```

Then `docker compose up -d backend` (no rebuild needed — it's already read from env in `backend/config/settings.py:391`). Verify it's actually 0 in the live container:

```bash
docker exec kbintra-prod-backend-1 uv run python -c \
  "from django.conf import settings; import os; print(os.getenv('SENTRY_PROFILES_SAMPLE_RATE'))"
```

If crashes stop within ~7 days of uptime, the Sentry profiler was it.

### Step 2 — drop Sentry DB instrumentation (small code change)

If step 1 doesn't resolve it, narrow Sentry's `DjangoIntegration` further. The cursor `execute`/`connect` patches are the next-most-likely culprit (visible in both threads of the traceback). Either:

- Drop `DjangoIntegration` from the `integrations=[...]` list in `backend/config/settings.py` entirely (Sentry still works for unhandled exceptions via the framework-agnostic path), **or**
- Set `SENTRY_TRACES_SAMPLE_RATE=0` to disable performance tracing (this is what causes the cursor wrappers to actually open spans on every query).

Try `traces_sample_rate=0` first — it's env-only and reversible.

### Step 3 — shrink or drop `mmap_size`

If steps 1–2 don't help, the next suspect is SQLite mmap interacting with Litestream's WAL access. In `backend/config/settings.py:144`:

```python
" PRAGMA mmap_size=134217728;"  # 128MB memory-mapped I/O — faster reads
```

Either reduce to a small value (e.g. 4MB) or remove the line entirely. For ~90 users the perf impact is negligible. Requires a backend rebuild.

### Step 4 — swap Daphne for Uvicorn

Edit `backend/docker-entrypoint.sh` (lines 38–49). Django Channels supports both. Sidesteps any Daphne-specific thread-pool quirks.

### Step 5 — run without Litestream for a few days (riskier)

Force the non-Litestream branch in `backend/docker-entrypoint.sh` (set `S3_BACKUP_BUCKET=""` for backend only, or comment out the `if [ -n "$S3_BACKUP_BUCKET" ]` branch). **Coordinate with the user first** — this disables continuous DB replication during the test window.

### Step 6 — refactor `apps/messaging/views.py` channel layer calls (last resort)

18 `async_to_sync(channel_layer.group_send)` calls run from sync DRF views, each spinning up a transient event loop on the shared `channel_layer` Redis pool. Wrap each in a tiny Huey task so all sends originate from the Huey worker's stable event loop.

### Step 7 — pin Python 3.12 as a last-ditch fix

`FROM python:3.12-slim` in `backend/Dockerfile` — only if the traceback points at CPython internals.

## References

- [getsentry/sentry-python#2386 — Segmentation fault in sentry profiler](https://github.com/getsentry/sentry-python/issues/2386) — Django + gunicorn workers, frame-extraction crash
- [getsentry/sentry-python discussion #3115 — Segfault possibly caused by sentry-python 2.3](https://github.com/getsentry/sentry-python/discussions/3115) — daily SIGSEGV after upgrade from 1.32 → 2.3 with profiling on
- [django/asgiref#71 — ThreadPool execution should preserve contextvar context](https://github.com/django/asgiref/issues/71) — relevant to how Sentry's threading integration interacts with sync-in-async
- [autobahn#1717 — SIGILL in `_xormasker.py`](https://github.com/crossbario/autobahn-python/issues/1717) — original NVX crash family; introduced the `AUTOBAHN_USE_NVX` kill switch (demoted but kept for context)
- [autobahn#1767 — Runtime pure-Python fallback for NVX doesn't work consistently](https://github.com/crossbario/autobahn-python/issues/1767)
- [django/channels#859 — Cannot call AsyncToSync twice in one sync context for channels_redis](https://github.com/django/channels/issues/859)
- [django/channels#2079 — `group_send()` not working from Django view](https://github.com/django/channels/issues/2079)
