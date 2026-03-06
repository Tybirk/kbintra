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

# Create data directory for SQLite and media
mkdir -p data
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

Fill in:
- `SECRET_KEY`: Generate with `python -c "import secrets; print(secrets.token_urlsafe(50))"`
- `ALLOWED_HOSTS`: Your domain (e.g., `app.yourdomain.com`)
- `CORS_ALLOWED_ORIGINS`: `https://app.yourdomain.com`
- `CSRF_TRUSTED_ORIGINS`: `https://app.yourdomain.com`
- `CLOUDFLARE_TUNNEL_TOKEN`: Token from Cloudflare dashboard
- `MESSAGES_ENCRYPTION_KEY`: Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — **back up this key separately; if lost, encrypted messages are unrecoverable**

### Push Notifications (Optional)

To enable Web Push notifications:

```bash
# Generate VAPID keys (run once, requires Node.js)
npx web-push generate-vapid-keys
```

Add the generated keys to your `.env` file:
- `VAPID_PUBLIC_KEY`: The public key
- `VAPID_PRIVATE_KEY`: The private key
- `VAPID_ADMIN_EMAIL`: Contact email for push service

## Deploy

```bash
# Build and start
docker compose up -d --build

# Run migrations
docker compose exec backend uv run python manage.py migrate

# Encrypt existing messages (one-time, only needed on first deploy — new messages are encrypted automatically)
docker compose exec backend uv run python manage.py encrypt_messages

# Create superuser (optional)
docker compose exec backend uv run python manage.py createsuperuser

# View logs
docker compose logs -f
```

## Backup SQLite

Add to crontab (`crontab -e`):

```cron
# Daily backup at 3 AM
0 3 * * * cp /opt/kbintra/data/db.sqlite3 /opt/kbintra/data/backups/db-$(date +\%Y\%m\%d).sqlite3
# Keep last 7 days
0 4 * * * find /opt/kbintra/data/backups -name "db-*.sqlite3" -mtime +7 -delete
```

## Updates

```bash
cd /opt/kbintra
git pull
docker compose up -d --build
docker compose exec backend uv run python manage.py migrate
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

## Pre-Deployment Checks

Before deploying, run these checks locally:

```bash
# Backend checks (from /backend directory)
uv run ruff check .          # Linting
uv run ruff format --check . # Formatting
uvx ty check                 # Type checking
uv run pytest                # Tests

# Frontend checks (from /frontend directory)
npm run lint                 # ESLint
npm run build               # Build check
npm test -- --run           # Tests
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
- Ensure `/opt/kbintra/data/media` directory exists and has correct permissions
- Check MEDIA_URL in Django settings

**Database locked errors:**
- SQLite concurrent write issue - restart backend container
- Consider increasing busy_timeout in settings if frequent
