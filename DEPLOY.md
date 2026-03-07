# Deployment Guide

Deploy to a Hetzner VPS with Docker Compose, Traefik, and Cloudflare Tunnel.

## Prerequisites

- Hetzner VPS (CX22 or similar, ~€4.50/month)
- Domain pointed to Cloudflare
- Cloudflare Tunnel created

## Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Install Docker
curl -fsSL https://get.docker.com | sh

# Create app directory
mkdir -p /opt/kbintra
cd /opt/kbintra

# Clone your repo
git clone https://github.com/yourusername/kbintra.git .

# Data directory is created automatically by deploy.sh
```

## Cloudflare Tunnel Setup

1. Go to Cloudflare Zero Trust Dashboard
2. Access > Tunnels > Create a tunnel
3. Name it (e.g., "kbintra")
4. Copy the tunnel token
5. Configure public hostname:
   - Subdomain: your choice (e.g., `app`)
   - Domain: your domain
   - Service: `http://traefik:80`

## Environment Setup

```bash
# Copy example env and edit
cp .env.example .env
nano .env
```

Required:
- `SECRET_KEY`: Generate with `python -c "import secrets; print(secrets.token_urlsafe(50))"`
- `ALLOWED_HOSTS`: Your domain (e.g., `app.yourdomain.com`)
- `CORS_ALLOWED_ORIGINS`: `https://app.yourdomain.com`
- `CSRF_TRUSTED_ORIGINS`: `https://app.yourdomain.com`
- `SITE_URL`: `https://app.yourdomain.com`
- `CLOUDFLARE_TUNNEL_TOKEN`: Token from Cloudflare dashboard
- `MESSAGES_ENCRYPTION_KEY`: Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — **back up this key separately; if lost, encrypted messages are unrecoverable**

### Push Notifications (Optional)

```bash
# Generate VAPID keys (run once, requires Node.js)
npx web-push generate-vapid-keys
```

Add to `.env`:
- `VAPID_PUBLIC_KEY`: The public key
- `VAPID_PRIVATE_KEY`: The private key
- `VAPID_ADMIN_EMAIL`: Contact email for push service

### S3 Backup Storage (Optional)

Add to `.env` (leave `S3_BACKUP_BUCKET` empty to disable):

```
S3_BACKUP_BUCKET=your-bucket-name
S3_BACKUP_ENDPOINT=https://xxx.r2.cloudflarestorage.com
S3_BACKUP_ACCESS_KEY=your-access-key
S3_BACKUP_SECRET_KEY=your-secret-key
S3_BACKUP_REGION=auto
S3_BACKUP_PREFIX=media/
```

Works with any S3-compatible storage (AWS S3, Cloudflare R2, MinIO, etc.).

When enabled, media files are automatically synced to S3 via background tasks and the database is backed up to S3 on each deploy. If a local media file goes missing, it's transparently restored from S3 on access.

## Deploy

```bash
./deploy.sh
```

The script handles everything automatically:

1. Checks DNS resolution
2. Tags current git state for rollback (`deploy-YYYYMMDD-HHMMSS`)
3. Pulls latest changes
4. Backs up SQLite database locally (keeps last 10 in `./data/backups/`)
5. Backs up SQLite database to S3 (if configured)
6. Rebuilds and restarts all Docker containers (migrations run automatically on startup)
7. Prunes old Docker images
8. Waits for backend health check

### First Deploy

On first deploy, also create a superuser:

```bash
docker compose exec backend uv run python manage.py createsuperuser
```

If enabling S3 backup on an existing installation, upload existing media files:

```bash
docker compose exec backend uv run python manage.py sync_media_to_s3 --dry-run  # Preview
docker compose exec backend uv run python manage.py sync_media_to_s3            # Upload
```

### Rollback

```bash
git checkout deploy-YYYYMMDD-HHMMSS && docker compose up -d --build
```

## Backups

### Local database backups

Every deploy creates a local snapshot at `./data/backups/db-YYYY-MM-DD-HHMMSS.sqlite3` using SQLite's online backup API. The 10 most recent are kept; older ones are pruned automatically.

### S3 backups

When `S3_BACKUP_BUCKET` is configured:

**Media files** — Synced automatically via Django signals + Huey tasks:
- File uploads are backed up on create
- Profile picture replacements delete old + upload new
- File deletions are mirrored to S3
- Missing local files are restored from S3 on access

**Database** — Backed up to S3:
- Automatically on each deploy (via `deploy.sh`)
- On demand via management command or Huey task:

```bash
# Management command (synchronous)
docker compose exec backend uv run python manage.py backup_db_to_s3

# Upload all existing media files
docker compose exec backend uv run python manage.py sync_media_to_s3
```

```python
# Huey task (background)
from apps.backup.tasks import backup_database_to_s3_task
backup_database_to_s3_task()
```

**S3 bucket structure:**

```
<S3_BACKUP_PREFIX>/
  post_attachments/...
  forum_files/...
  message_attachments/...
  announcement_attachments/...
  profile_pictures/...
  house_pictures/...
  rooms/...
  db-backups/
    db-20260307-120000.sqlite3
    db-20260306-120000.sqlite3
```

## Pre-Deployment Checks

Before deploying, run these checks locally:

```bash
# Backend checks (from /backend directory)
uv run ruff check .          # Linting
uv run ruff format --check . # Formatting
uvx ty check                 # Type checking
uv run pytest                # Tests

# Frontend checks (from /frontend directory)
npm run typecheck            # Type checking (tsgo)
npm run lint                 # Linting (oxlint)
npm run format:check         # Formatting (oxfmt)
npm run test:run             # Tests
```

## Useful Commands

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend

# Restart services
docker compose restart

# Stop everything
docker compose down

# Shell into backend
docker compose exec backend bash

# Django shell
docker compose exec backend uv run python manage.py shell
```

## Troubleshooting

### Common Issues

**WebSocket connection fails:**
- Ensure Daphne is running (check `docker compose logs backend`)
- Verify Traefik is forwarding WebSocket connections

**Push notifications not working:**
- Check VAPID keys are set in `.env`
- Verify browser supports push (HTTPS required)
- Check browser notification permissions

**Media files not loading:**
- Ensure `./data/media` directory exists and has correct permissions
- If S3 is configured, check S3 credentials and bucket access
- Check `docker compose logs backend` for S3 download errors

**Database locked errors:**
- SQLite has a 20s write timeout configured — transient locks are expected under concurrent writes
- Check `docker compose logs backend` for frequency
- If persistent, restart backend: `docker compose restart backend`
