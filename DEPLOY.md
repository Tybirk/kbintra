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

## Deploy

```bash
# Build and start
docker compose up -d --build

# Run migrations
docker compose exec backend uv run python manage.py migrate

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
