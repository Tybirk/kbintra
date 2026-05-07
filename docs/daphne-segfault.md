# Daphne Segfault — 2026-05-07

Backend crashed three times in 24h with `exit status 139` (SIGSEGV in `libpython3.11.so.1.0`). Auto-recovers via `restart: unless-stopped`, but each restart causes ~3 min downtime (migrations + search index rebuild).

## Symptoms

- `docker compose ps` shows backend `Up <minutes> (unhealthy)` while every other service has been up for days.
- `docker compose logs backend` ends with: `level=ERROR msg="failed to run" error="exit status 139"` from Litestream — no Python traceback before it (the crash is below the Python layer).
- Health check fails with `Connection refused` for ~3 min after restart while migrations + search index rebuild run.

## Diagnostics

```bash
# 1. Confirm the crash signature at the kernel level — most useful single command
dmesg --since "24h ago" | grep -iE "segfault|oom|killed"
# Expect: daphne[<pid>]: segfault at <addr> ip <ip> ... in libpython3.11.so.1.0

# 2. Count restarts — how often is it happening
docker compose logs backend --since 24h | grep "exit status 139"

# 3. Rule out OOM (we've already confirmed memory is not the issue, but check again)
free -h
docker stats kbintra-prod-backend-1 --no-stream

# 4. Health-check history to distinguish startup-fail vs persistent-fail
docker inspect kbintra-prod-backend-1 --format='{{json .State.Health}}' | python3 -m json.tool
```

## Root cause (hypothesis)

Crash is in `libpython3.11.so.1.0` during Daphne operation. One crash had `ip 0x19` — a near-null deref typical of a use-after-free in async code. No OOM, no Python exception → it's a memory-corruption bug in a C extension.

Most likely culprit: **Autobahn**, the WebSocket protocol library Daphne uses via Twisted. Crashes happened mid-session with active WebSocket traffic (`/ws/chat/`).

## Action taken

Upgraded **Autobahn 25.11.1 → 25.12.2** (two releases newer). Twisted 25.5.0 and Daphne 4.2.1 were already at latest.

Autobahn is a transitive dep (pulled by Daphne, not pinned in `pyproject.toml`), so updating only the lock file was sufficient:

```bash
# uv lives in the container, not on the host
docker exec kbintra-prod-backend-1 uv lock --upgrade-package autobahn
docker cp kbintra-prod-backend-1:/app/uv.lock backend/uv.lock
docker compose build backend && docker compose up -d backend

# Verify
docker exec kbintra-prod-backend-1 uv run python -c "import autobahn; print(autobahn.__version__)"
# Expected: 25.12.2
```

### Confidence: low

After reading the 25.12.1 + 25.12.2 changelogs, the upgrade is **probably not** the fix. Both releases are dominated by CI/build/packaging changes. Only one runtime fix is potentially adjacent:

- **autobahn #1767** — "Runtime pure Python fallback for NVX doesn't work consistently". NVX is Autobahn's native fast path for `Utf8Validator` and `create_xor_masker`, called on every WebSocket frame. The fix is about `HAS_NVX` selection consistency. This *could* relate to native/Python state mismatch causing memory corruption, but the issue's stated failure mode is `ImportError`, not SIGSEGV.

Treat the deployment as "watch for recurrence" rather than "resolved." If it crashes again, skip further Autobahn version tweaks and go straight to the escalation options below.

## If it recurs

1. **Confirm same signature** with `dmesg | grep daphne`. If the crash is in a different library or shows `oom-killer`, it's a different problem.
2. **Check for newer Autobahn** — `docker exec kbintra-prod-backend-1 uv run pip index versions autobahn`. Same for `twisted` and `daphne`.
3. **Correlate with WebSocket activity** — `docker compose logs backend --since 1h | grep -E "WSCONNECT|WSDISCONNECT"` near the crash time, to see if a specific connection pattern triggers it.
4. **Escalation options** if version bumps don't help:
   - Swap Daphne for **Uvicorn** in `docker-entrypoint.sh` — Uvicorn uses `websockets`/`wsproto`, sidestepping Autobahn entirely. Django Channels supports both.
   - Pin to **Python 3.12** in the Dockerfile (`FROM python:3.12-slim`) if a 3.11-specific CPython bug is suspected.
   - As a last resort, route `/ws/` traffic to a maintenance handler to confirm WebSockets are the trigger.
