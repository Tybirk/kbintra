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

# Validate critical settings in production
if not DEBUG and SECRET_KEY.startswith("django-insecure"):
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("SECRET_KEY must be set in production (DEBUG=False)")

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
    "apps.calendar_app",
    "apps.messaging",
    "apps.notifications",
    "apps.search",
    "apps.bookings",
    "apps.links",
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
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
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
}

# File upload settings
DATA_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 50 * 1024 * 1024  # 50MB

# Application-level file limits (validated in serializers)
MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024  # 50MB per file
MAX_DOCX_PREVIEW_SIZE = 50 * 1024 * 1024  # 50MB - skip DOCX preview for larger files

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

# Production security settings
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
