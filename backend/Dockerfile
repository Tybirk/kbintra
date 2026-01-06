FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application
COPY . .

# Collect static files
RUN uv run python manage.py collectstatic --noinput

# Run with daphne (ASGI server for channels support)
EXPOSE 8000
CMD ["uv", "run", "daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
