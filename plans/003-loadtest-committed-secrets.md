# Plan 003: Remove committed secrets from docker-compose.loadtest.yml and document key rotation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **SECRET-HANDLING RULE**: never copy the actual key values into any file you
> write, including commit messages and this plan's status notes. Refer to them
> only by location (`docker-compose.loadtest.yml` lines 15/24/29/41/44).
>
> **Drift check (run first)**: `git diff --stat 023ad2c..HEAD -- docker-compose.loadtest.yml .env.example docs/architecture.md`
> On mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1
- **Effort**: S (file changes) — plus an operator-only verification/rotation step
- **Risk**: LOW for the file change; the operator decision (rotate or not) carries the real weight
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `023ad2c`, 2026-06-12

## Why this matters

`docker-compose.loadtest.yml` (committed since commit `4c6a3b4`) hardcodes a real Fernet `MESSAGES_ENCRYPTION_KEY` (lines 15, 29, 44) and a `SECRET_KEY` (lines 24, 41). The Fernet key is the at-rest encryption key format used for private messages. The SECRET_KEY value is self-labeled not-for-production, and the file is a local loadtest overlay — but the Fernet key is a *real generated key sitting in git history*. If that key is, or ever was, the production `MESSAGES_ENCRYPTION_KEY` (note: `deploy-test.sh` copies the production DB to staging, so prod-encrypted data does get used outside prod), every private message in the production database is decryptable by anyone with repo access. Even if it is loadtest-only, committed keys normalize a dangerous pattern. A committed secret is burned: removal alone is insufficient; the fix includes a rotation decision.

## Current state

- `docker-compose.loadtest.yml` — a compose overlay layered on `docker-compose.local.yml` for prod-like load testing. Lines 13-15, 19-29, 38-44 set env vars inline, including `MESSAGES_ENCRYPTION_KEY=<literal key>` three times and `SECRET_KEY=<literal value>` twice. The `huey` service (line 36-37) already loads `.env` via `env_file` and then *overrides* it with the inline literals.
- `.env` is gitignored (`.gitignore` lines 173-178 cover `.env`, `*.env`); `.env.example` is the committed template with placeholder values for `SECRET_KEY` (line 2) and `MESSAGES_ENCRYPTION_KEY` (line 11).
- `docs/architecture.md` has a "Message Encryption" section (≈lines 101-125) documenting key generation and initial setup, but **no key-rotation procedure**.
- Compose supports `${VAR:?error}` substitution from the shell environment and from a `.env` file in the project root.

## Commands you will need

| Purpose | Command (from repo root) | Expected on success |
|---|---|---|
| Confirm no secrets remain | `grep -nE "ENCRYPTION_KEY=|SECRET_KEY=" docker-compose.loadtest.yml` | every hit uses `${...}` substitution, no literal values |
| Compose config validates | `docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml config -q` | exit 0 (requires the vars set in `.env`; see Step 2) |
| Repo-wide secret sweep | `git grep -nE "MESSAGES_ENCRYPTION_KEY=[A-Za-z0-9_-]{20,}" -- ':!plans'` | no matches |

## Scope

**In scope**: `docker-compose.loadtest.yml`, `.env.example`, `docs/architecture.md`.

**Out of scope**:

- Rewriting git history (BFG/filter-repo). The key remains in history regardless; rotation is the remedy. Do not attempt history rewrites.
- Production `.env` / actual rotation — operator-only (see Maintenance notes).
- `docker-compose.yml` and `docker-compose.local.yml` — verified clean of secrets at planning time; don't touch.

## Git workflow

- Branch: `advisor/003-loadtest-committed-secrets`
- One commit, e.g. `security: move loadtest secrets to env substitution`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace literals with env substitution

In `docker-compose.loadtest.yml`, replace every inline secret line:

- `- MESSAGES_ENCRYPTION_KEY=<literal>` → `- MESSAGES_ENCRYPTION_KEY=${LOADTEST_MESSAGES_ENCRYPTION_KEY:?Set LOADTEST_MESSAGES_ENCRYPTION_KEY in .env}`
- `- SECRET_KEY=<literal>` → `- SECRET_KEY=${LOADTEST_SECRET_KEY:-loadtest-secret-key}`

(The SECRET_KEY can keep a non-secret default — it's a local loadtest. The Fernet key must NOT have a default; `:?` makes compose fail loudly.) Update the header comment (lines 1-9) to say the keys come from `.env`.

**Verify**: `grep -nE "ENCRYPTION_KEY=|SECRET_KEY=" docker-compose.loadtest.yml` → all hits contain `${`.

### Step 2: Update .env.example

Add to `.env.example` (placeholders only, with a comment):

```
# Loadtest overlay (docker-compose.loadtest.yml) — generate a throwaway key:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
LOADTEST_MESSAGES_ENCRYPTION_KEY=
```

**Verify**: add the two vars to your local `.env` with a freshly generated throwaway key, then `docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml config -q` → exit 0. Also verify that omitting `LOADTEST_MESSAGES_ENCRYPTION_KEY` makes the same command FAIL with the `:?` message.

### Step 3: Document key rotation in docs/architecture.md

Append a "Key rotation" subsection to the existing "Message Encryption" section, covering: (1) generate new key; (2) decrypt-and-re-encrypt requires both keys — note that the current `EncryptedTextField` (`backend/apps/messaging/encryption.py`) supports only ONE key, so rotation today means: take the app offline briefly, run a one-off script that decrypts each `Message.content` with the old key and re-encrypts with the new, then swap the env var; (3) back up the old key until rotation is verified. Keep it to ~15 lines; do not write the rotation script itself in this plan.

**Verify**: section exists; `git grep -n "Key rotation" docs/architecture.md` → 1 hit.

### Step 4: Repo-wide sweep

`git grep -nE "MESSAGES_ENCRYPTION_KEY=[A-Za-z0-9_-]{20,}" -- ':!plans'` → no matches. Also `git grep -nE "SECRET_KEY=[a-z-]+-not-for-production"` → no matches.

## Test plan

No code paths change; the verification commands above are the test. Backend suite (`cd backend && uv run pytest`) must still pass untouched (it should — nothing in scope is imported by code).

## Done criteria

- [ ] No literal secret values anywhere in tracked files (`git grep` sweeps above return nothing)
- [ ] `docker compose -f docker-compose.local.yml -f docker-compose.loadtest.yml config -q` exits 0 with vars set, fails loudly without
- [ ] `.env.example` documents the new vars with empty placeholders
- [ ] `docs/architecture.md` has the Key rotation subsection
- [ ] `cd backend && uv run pytest` exits 0 (untouched)
- [ ] `plans/README.md` status row updated

## STOP conditions

- You find the same key value referenced anywhere else in the repo or its history (`git log -S"<first 8 chars of the key>" --oneline` — run it, but never write the output's key content anywhere) in a NON-loadtest file → report immediately; that changes the severity assessment.
- `docker compose ... config` fails for a reason unrelated to the new vars.

## Maintenance notes — OPERATOR ACTION REQUIRED

- **The operator must check whether the committed key matches production**: compare `docker-compose.loadtest.yml` git history's key against the production `.env` on the server. **If they match, rotate the production key immediately** following the new docs section, because the value is in git history forever.
- Even if they don't match: treat the committed key as burned; never reuse it.
- Reviewer checklist: confirm no secret value appears in the diff, commit message, or plan status note.
