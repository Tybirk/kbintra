"""
Django settings for KB Intra community platform.
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Data directory: in Docker this is a mounted volume (/app/data), locally it's BASE_DIR.
# Using a directory mount (not individual file mounts) ensures SQLite WAL/SHM files are shared
# between the backend and huey containers.
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR)))

# Security settings
SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "django-insecure-dev-key-change-in-production",
)

DEBUG = os.getenv("DEBUG", "True").lower() == "true"

ALLOWED_HOSTS: list[str] = os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# Message encryption key (Fernet). Required in production, optional in dev.
MESSAGES_ENCRYPTION_KEY = os.getenv("MESSAGES_ENCRYPTION_KEY", "")

# Validate critical settings in production
if not DEBUG and SECRET_KEY.startswith("django-insecure"):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("SECRET_KEY must be set in production (DEBUG=False)")

if not DEBUG and not MESSAGES_ENCRYPTION_KEY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("MESSAGES_ENCRYPTION_KEY must be set in production (DEBUG=False)")

# Application definition
INSTALLED_APPS = [
    # Django apps
    "daphne",  # Must be before django.contrib.staticfiles for ASGI
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party apps
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "channels",
    "huey.contrib.djhuey",
    # Local apps
    "apps.users",
    "apps.houses",
    "apps.forum",
    "apps.announcements",
    "apps.food",
    "apps.events",
    "apps.messaging",
    "apps.notifications",
    "apps.search",
    "apps.bookings",
    "apps.links",
    "apps.backup",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Channels configuration
# Use Redis in production (set REDIS_URL), fall back to InMemory for local dev/tests
REDIS_URL = os.getenv("REDIS_URL", "")
if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }

# Database
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        "OPTIONS": {
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",  # Use WAL mode for better concurrency; full sync for durability. Init command is supported since django 5.1 for sqlite3!  We use Django 5.2+
        },
    }
}

# Custom User Model
AUTH_USER_MODEL = "users.User"

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# REST Framework settings
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "login": "5/minute",
    },
}

# File upload settings
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB

# Application-level file limits (validated in serializers)
MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024  # 50MB per file
MAX_DOCX_PREVIEW_SIZE = 50 * 1024 * 1024  # 50MB - skip DOCX preview for larger files
MAX_PDF_PREVIEW_SIZE = 20 * 1024 * 1024  # 20MB - skip PDF preview for larger files
MAX_PDF_PREVIEW_PAGES = 20  # Max pages to include in PDF HTML preview

# JWT settings
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
}

# CORS settings
CORS_ALLOWED_ORIGINS: list[str] = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

CORS_ALLOW_CREDENTIALS = True

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Europe/Copenhagen"
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Media files (uploads)
MEDIA_URL = "media/"
MEDIA_ROOT = DATA_DIR / "media"

# S3 backup storage (set S3_BACKUP_BUCKET to enable; empty = disabled)
S3_BACKUP_BUCKET = os.getenv("S3_BACKUP_BUCKET", "")
S3_BACKUP_ENDPOINT = os.getenv("S3_BACKUP_ENDPOINT", "")
S3_BACKUP_ACCESS_KEY = os.getenv("S3_BACKUP_ACCESS_KEY", "")
S3_BACKUP_SECRET_KEY = os.getenv("S3_BACKUP_SECRET_KEY", "")
S3_BACKUP_REGION = os.getenv("S3_BACKUP_REGION", "auto")
S3_BACKUP_PREFIX = os.getenv("S3_BACKUP_PREFIX", "media/")

# Default primary key field type
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Email settings
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"
EMAIL_USE_SSL = os.getenv("EMAIL_USE_SSL", "False").lower() == "true"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
RESEND_SMTP_PORT = 587
RESEND_SMTP_USERNAME = "resend"
RESEND_SMTP_HOST = "smtp.resend.com"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "KB Intra <noreply@kbintra.local>")
SITE_URL = os.getenv("SITE_URL", "http://localhost:5173")

# Web Push settings
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_ADMIN_EMAIL = os.getenv("VAPID_ADMIN_EMAIL", "admin@kbintra.local")

# VAPID claims for pywebpush
VAPID_CLAIMS = {"sub": f"mailto:{VAPID_ADMIN_EMAIL}"} if VAPID_PRIVATE_KEY else None

# Legacy format (for backwards compatibility)
WEBPUSH_SETTINGS = {
    "VAPID_PUBLIC_KEY": VAPID_PUBLIC_KEY,
    "VAPID_PRIVATE_KEY": VAPID_PRIVATE_KEY,
    "VAPID_ADMIN_EMAIL": VAPID_ADMIN_EMAIL,
}

# CSRF trusted origins (needed for POST requests through proxy)
CSRF_TRUSTED_ORIGINS: list[str] = os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost,http://127.0.0.1",
).split(",")

# Google Drive settings for menu fetching
GOOGLE_DRIVE_API_KEY = os.getenv("GOOGLE_DRIVE_API_KEY", "")
GOOGLE_DRIVE_MENU_FOLDER_ID = os.getenv(
    "GOOGLE_DRIVE_MENU_FOLDER_ID", "18AaQw20ZlWIKLeeyW2R0OrXFaSkc2rPm"
)
MENU_CACHE_HOURS = int(os.getenv("MENU_CACHE_HOURS", "12"))

# Huey task queue
HUEY = {
    "huey_class": "huey.SqliteHuey",
    "name": "kb-intra",
    "results": False,
    "immediate": DEBUG,  # Sync in dev/test, async in prod
    "filename": str(DATA_DIR / "huey.db"),
    "consumer": {
        "workers": 2,
        "worker_type": "thread",
    },
}

# Logging configuration
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO" if not DEBUG else "DEBUG",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "WARNING" if not DEBUG else "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR" if not DEBUG else "DEBUG",
            "propagate": False,
        },
        "apps": {
            "handlers": ["console"],
            "level": "INFO" if not DEBUG else "DEBUG",
            "propagate": False,
        },
    },
}

# Sentry error monitoring
# Configure by setting SENTRY_DSN in the environment; all other settings are optional.
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if SENTRY_DSN:
    import logging as _logging

    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.huey import HueyIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    def _sentry_before_send(event: dict, hint: dict) -> dict | None:
        """Drop known non-actionable exceptions so they don't create noise in Sentry."""
        exc_info = hint.get("exc_info")
        if exc_info:
            exc_type = exc_info[0]
            # simplejwt token errors are user-facing (expired/invalid tokens), not server bugs
            if exc_type.__name__ in ("TokenError", "InvalidToken", "TokenExpiredError"):
                return None
        return event

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=os.getenv("SENTRY_ENVIRONMENT", "development" if DEBUG else "production"),
        release=os.getenv("SENTRY_RELEASE") or None,
        integrations=[
            DjangoIntegration(
                transaction_style="url",  # Group transactions by URL pattern, not function name
                middleware_spans=True,  # Track time spent in each middleware
                signals_spans=False,  # Skip Django signal spans (too noisy for small app)
                cache_spans=False,  # Skip cache spans (not using Django cache framework)
            ),
            LoggingIntegration(
                level=_logging.INFO,  # Capture INFO+ as breadcrumbs (gives context before error)
                event_level=_logging.ERROR,  # Send ERROR+ log records as Sentry events
            ),
            RedisIntegration(),  # Redis commands as breadcrumbs (channel layer operations)
            HueyIntegration(),  # Track Huey background task errors and performance
        ],
        # Performance: capture 10% of requests as traces in production
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        # Profiling: sample 10% of traced requests for CPU profiling
        profiles_sample_rate=float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "0.1")),
        # Include authenticated user email/name in error reports
        send_default_pii=True,
        before_send=_sentry_before_send,
    )

# Production security settings
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
