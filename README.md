# KB Intra - Community Communication Platform

An internal communication platform for a co-living community with forum, food management, messaging, calendar, and resident directory features.

## Tech Stack

- **Backend**: Django 5.x with Django REST Framework
- **Frontend**: React 19 with Vite, Mantine UI v8, TypeScript
- **Database**: SQLite (dev and production)
- **Authentication**: JWT via djangorestframework-simplejwt
- **Real-time**: Django Channels with WebSockets
- **Package Management**: uv (Python), npm (JavaScript)
- **Testing**: pytest (backend), React Testing Library (frontend)

## Project Structure

```
kbintra/
├── backend/                    # Django REST API
│   ├── config/                 # Django project settings
│   │   ├── settings.py         # Main settings with JWT, CORS, Channels
│   │   ├── urls.py             # API route configuration
│   │   └── asgi.py             # ASGI config for WebSockets
│   ├── apps/
│   │   ├── users/              # User management & profiles
│   │   ├── houses/             # Houses and inhabitants
│   │   ├── forum/              # Forum with subgroups, threads, files
│   │   ├── announcements/      # Community announcements
│   │   ├── food/               # Food module (menus, teams, tickets)
│   │   ├── calendar_app/       # Community calendar
│   │   ├── messaging/          # Direct messaging system
│   │   └── notifications/      # Notification system with email
│   ├── conftest.py             # Pytest fixtures
│   ├── manage.py
│   └── pyproject.toml          # uv project config
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── api/                # API client functions
│   │   ├── components/         # Shared components
│   │   ├── pages/              # Page components
│   │   ├── store/              # Zustand state management
│   │   ├── types/              # TypeScript type definitions
│   │   └── hooks/              # Custom React hooks
│   ├── package.json
│   └── vite.config.ts          # Vite + PWA config
└── README.md
```

## Setup

For a streamlined one-command setup, see [INSTALL.md](INSTALL.md).

### Prerequisites
- Python 3.11+
- Node.js 18+ (20+ recommended)
- uv (Python package manager)
- prek (pre-commit hook manager): `uv tool install prek`

### Pre-commit Hooks

Install pre-commit hooks to run linting automatically before each commit:

```bash
prek install -f .
```

### Backend Setup

```bash
cd backend

# Install dependencies
uv sync

# Run migrations
uv run python manage.py migrate

# Create superuser (for admin access)
uv run python manage.py createsuperuser

# Optionally seed some data (currently seed users requires a CSV I did not commit)
uv run python manage.py seed_forum_subgroups

# Run development server
uv run python manage.py runserver 7000


uv run ruff check --fix .   # Linting
uv run ruff format .  # Formatting
uvx ty check         # Type checking - note this is not completely implemented, so can be disregarded for now
uv run pytest         # Tests
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

### Access the Application
- Frontend: http://localhost:5173
- Backend API: http://localhost:7000/api/
- Admin: http://localhost:7000/admin/

## Features Overview

### User Management
- Email-based authentication (no username)
- Invitation-only registration system
- Profile management with picture upload
- House assignment for residents

### Forum System
- **Subgroups**: Organized discussion categories
  - Regular groups and committees (udvalg) with distinct styling
  - Subscription system with notification preferences
  - Ordered by last activity (committees first)
- **Threads & Posts**: Discussion threads with rich text (Tiptap editor)
- **Documents**: File storage per subgroup
  - Folder organization with nested subfolders
  - Root-level files supported
  - Move files between folders (owner/admin only)

### Food Module
- **Weekly Menus**: View and manage weekly meal menus (Mon-Thu)
  - Menu templates for reusable dishes
  - Meat option on Wednesdays
- **Meal Registration**: Register for daily meals
  - Default preferences per weekday
  - Eat-in (2 seating times) or take-away
- **Food Tickets**: Trade unused meal spots
  - List tickets for sale or free
  - Claim available tickets
- **Food Teams**: Cooking team organization
  - Team cycles with date ranges
  - Wish submission for available dates
  - Automatic team generation algorithm
  - Team swap requests between members

### Communication
- **Announcements**: Priority community-wide posts
- **Direct Messaging**: Real-time chat via WebSocket
  - Typing indicators and read receipts
  - Unread count in header
- **Notifications**: In-app and email notifications
  - Per-type preferences
  - Real-time delivery via WebSocket

### Calendar
- Month view with event display
- Create/edit/delete community events
- All-day events supported
- Dashboard widget for upcoming events

## Running Tests

### Backend Tests

```bash
cd backend

# Run all tests
uv run pytest

# Run specific app tests
uv run pytest apps/forum/tests.py -v
uv run pytest apps/food/tests.py -v

# Run with coverage
uv run pytest --cov=apps --cov-report=html
```

### Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Run with coverage
npm test -- --coverage
```

## API Documentation

See the detailed API documentation in [backend/README.md](backend/README.md).

Key endpoint groups:
- `/api/auth/` - Authentication (login, register, invitations)
- `/api/users/` - User profiles
- `/api/houses/` - House directory
- `/api/forum/` - Forum (subgroups, threads, posts, files)
- `/api/announcements/` - Announcements
- `/api/food/` - Food (menus, registrations, tickets, teams)
- `/api/calendar/` - Calendar events
- `/api/messages/` - Direct messaging
- `/api/notifications/` - Notifications and preferences

WebSocket: `ws://localhost:7000/ws/chat/?token=<jwt>`

## Environment Variables

Create `.env` in backend/:
```
SECRET_KEY=your-secret-key-here
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SITE_URL=http://localhost:5173
```

## Email Setup

The application uses email for:
- Password reset flows
- Notification emails (new messages, announcements, forum replies, etc.)

### Email Configuration Overview

| Variable | Description | Default |
|----------|-------------|---------|
| `EMAIL_BACKEND` | Django email backend class | `django.core.mail.backends.console.EmailBackend` |
| `EMAIL_HOST` | SMTP server hostname | (empty) |
| `EMAIL_PORT` | SMTP server port | `587` |
| `EMAIL_USE_TLS` | Use TLS encryption | `True` |
| `EMAIL_USE_SSL` | Use SSL encryption | `False` |
| `EMAIL_HOST_USER` | SMTP username/email | (empty) |
| `EMAIL_HOST_PASSWORD` | SMTP password/app password | (empty) |
| `DEFAULT_FROM_EMAIL` | Sender email address | `KB Intra <noreply@kbintra.local>` |
| `SITE_URL` | Base URL for links in emails | `http://localhost:5173` |

### Development Setup

In development, emails are printed to the console by default. No configuration needed.

```bash
# backend/.env (development - default)
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
SITE_URL=http://localhost:5173
```

To test the email flow in development, trigger a password reset or enable email notifications in user preferences. Emails will appear in the terminal running the Django server.

### Production Setup

For production, configure an SMTP provider. Add these to your `.env` or docker environment:

```bash
# backend/.env (production)
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@example.com
EMAIL_HOST_PASSWORD=your-app-password
DEFAULT_FROM_EMAIL=KB Intra <noreply@yourdomain.com>
SITE_URL=https://yourdomain.com
```

### Docker Production Configuration

Add email variables to `docker-compose.yml`:

```yaml
services:
  backend:
    environment:
      - EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
      - EMAIL_HOST=smtp.example.com
      - EMAIL_PORT=587
      - EMAIL_USE_TLS=True
      - EMAIL_HOST_USER=your-email@example.com
      - EMAIL_HOST_PASSWORD=your-password
      - DEFAULT_FROM_EMAIL=KB Intra <noreply@yourdomain.com>
      - SITE_URL=https://yourdomain.com
```

### Testing Email Configuration

Test your email setup using Django's shell:

```bash
cd backend
uv run python manage.py shell
```

```python
from django.core.mail import send_mail
send_mail(
    'Test Email',
    'This is a test email from KB Intra.',
    None,  # Uses DEFAULT_FROM_EMAIL
    ['your-email@example.com'],
    fail_silently=False,
)
```

### User Email Preferences

Users can manage their email notification preferences at `/notifications` in the app. Available toggles:
- Direct messages
- Announcements
- Forum subscriptions (new threads)
- Thread replies
- Event reminders
- Food tickets

All email notifications are **opt-in** by default (disabled until user enables them)

## Development Notes

- Frontend proxies `/api` and `/media` to backend (configured in vite.config.ts)
- Profile pictures: `backend/media/profile_pictures/`
- Forum files: `backend/media/forum_files/`
- JWT access token: 1 hour, refresh token: 7 days
- InMemoryChannelLayer used (sufficient for ~90 users)

## Key Design Decisions

1. **Email-based auth**: Users login with email, not username
2. **Invitation-only**: New users need a valid invitation token linked to a house
3. **Subscription model**: Users subscribe to forum subgroups for notifications
4. **Simple permissions**: Admins via Django admin, users edit only own content
5. **PWA**: Installable web app with service worker
6. **Real-time**: WebSocket for messaging and notifications (no polling)

## Project Documentation

- [Backend README](backend/README.md) - API endpoints, models, testing
- [Frontend README](frontend/README.md) - Components, pages, state management

## License

KB Intra is licensed under the [GNU Affero General Public License v3.0](LICENSE.md).

Other communities are welcome to use, modify, and self-host this software. Because AGPL applies to network use, any modified version run as a network service must make its source code available to its users. See the [LICENSE.md](LICENSE.md) file for the full text.
