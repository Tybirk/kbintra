FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Litestream for continuous SQLite replication to S3
COPY --from=litestream/litestream:0.5.10 /usr/local/bin/litestream /usr/local/bin/litestream

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application
COPY . .

# Litestream config (reads S3 credentials from env vars at runtime)
COPY litestream.yml /etc/litestream.yml

# Collect static files
RUN uv run python manage.py collectstatic --noinput

# Run with daphne (ASGI server for channels support)
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
