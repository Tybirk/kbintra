# Daphne Segfault — Investigation Notes

Backend has crashed 4 times between 2026-05-03 and 2026-05-07 with `exit status 139` (SIGSEGV in `libpython3.11.so.1.0`). The container auto-recovers via `restart: unless-stopped`. Each restart causes a brief outage; the search-index rebuild now skips when the index is non-empty (`--if-empty`), so cold-restart downtime is shorter than it was originally.

## Crash signature

Four crashes, two patterns — same root cause:

| UTC timestamp        | Pattern | `ip` value                  | Notes |
|---|---|---|---|
| 2026-05-03 19:49:36  | A | `0x0000000000000001`         | Jumped to **address 0x1** (near-null function pointer) |
| 2026-05-06 18:20:16  | B | libpython base + **`0xeeecb`** | Jumped to libpython+0xeeecb (in `.rela.plt`, non-executable) |
| 2026-05-06 22:19:21  | A | `0x0000000000000019`         | Jumped to address 0x19 |
| 2026-05-07 10:30:57  | B | libpython base + **`0xeeecb`** | Same offset as crash #2 — deterministic |

**What both patterns mean:** the CPU was making an indirect call (e.g. `call *rax`) through a slot that should hold a function pointer. The slot held garbage. The fact that Pattern B lands at the *same offset* both times despite ASLR is decisive — it is the same corrupt value being interpreted as a function pointer, repeatedly. Most common source: a `tp_dealloc` slot or similar callback on a freed/reused PyObject.

This rules out random memory bugs and points to a **deterministic refcount/lifetime bug** in a C extension or async callback chain.

## Why we suspect Autobahn NVX

- The `huey` container (also Python 3.11, same image, same dependencies) is rock-stable. Only `backend` crashes.
- The only thing the backend does that huey doesn't: **serve WebSocket frames**.
- Autobahn ships C extensions (`_nvx_utf8validator`, `_nvx_xormasker`) that run on every WebSocket frame for UTF-8 validation and XOR (un)masking.
- There's a documented prior crash family in NVX: [autobahn#1717](https://github.com/crossbario/autobahn-python/issues/1717) (SIGILL in `_xormasker`, fixed in 25.10.2). The *kill switch* added in that release — `AUTOBAHN_USE_NVX=0` — disables NVX entirely and falls back to pure Python.

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

## Decision tree if it recurs

The next crash is the diagnostic event. With `PYTHONFAULTHANDLER=1` in place, we should now have a Python traceback in the logs.

1. **Pull the pre-crash log first** (before any redeploy):
   ```bash
   docker compose logs backend --since 24h > /tmp/pre-crash-backend.log
   ```
2. **Check the dmesg signature**:
   - Same `0xeeecb` offset → same bug, NVX did **not** fix it. Move to step 3.
   - Different signature (e.g. crash in `_rust.abi3.so`, `_cffi_backend`, `_sqlite3`) → different bug, investigate that library.
3. **NVX disabled and still crashing** → it isn't Autobahn. Move to escalation:
   - **Refactor `apps/messaging/views.py` channel layer calls.** 18 `async_to_sync(channel_layer.group_send)` calls run from sync DRF views, each spinning up a transient event loop on the shared `channel_layer` Redis pool. Wrap each in a tiny Huey task so all sends originate from the Huey worker's stable event loop.
   - **Swap Daphne for Uvicorn.** Sidesteps Autobahn entirely. Edit `backend/docker-entrypoint.sh` — Django Channels supports both servers.
   - **Pin Python 3.12** as a last resort (`FROM python:3.12-slim` in `backend/Dockerfile`) — only if the traceback points at CPython internals.

## References

- [autobahn#1717 — SIGILL in `_xormasker.py`](https://github.com/crossbario/autobahn-python/issues/1717) — original NVX crash family; introduced the `AUTOBAHN_USE_NVX` kill switch
- [autobahn#1767 — Runtime pure-Python fallback for NVX doesn't work consistently](https://github.com/crossbario/autobahn-python/issues/1767)
- [django/channels#859 — Cannot call AsyncToSync twice in one sync context for channels_redis](https://github.com/django/channels/issues/859)
- [django/channels#2079 — `group_send()` not working from Django view](https://github.com/django/channels/issues/2079)
