# Quick Install

## Prerequisites

- [uv](https://docs.astral.sh/uv/#installation) (Python and package manager — automatically installs the right Python version)
- [Node.js](https://nodejs.org/en/download) 18+ (20+ recommended)

## One-command setup

```bash
uv run setup.py    # Install deps, run migrations, build search index, set up pre-commit hooks
uv run dev.py      # Start backend + frontend dev servers
```

Then open http://localhost:5173.

## Optional extras

Admin access to the backend admin panel, and seeding of forum data.

```bash
cd backend
uv run python manage.py createsuperuser
uv run python manage.py seed_forum_subgroups
```
