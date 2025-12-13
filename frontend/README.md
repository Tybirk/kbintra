# KB Intra Frontend

React SPA frontend for the KB Intra community platform.

## Tech Stack

- React 18
- TypeScript
- Vite (build tool)
- Mantine UI v7 (component library)
- React Query (data fetching)
- Zustand (state management)
- React Router (routing)
- Tiptap (rich text editor)
- Axios (HTTP client)

## Project Structure

```
frontend/
├── src/
│   ├── api/                    # API client functions
│   │   ├── client.ts           # Axios instance with auth
│   │   ├── auth.ts             # Authentication endpoints
│   │   ├── users.ts            # User endpoints
│   │   ├── houses.ts           # House endpoints
│   │   ├── forum.ts            # Forum endpoints
│   │   ├── announcements.ts    # Announcement endpoints
│   │   ├── food.ts             # Food module endpoints
│   │   ├── calendar.ts         # Calendar endpoints
│   │   ├── messaging.ts        # Messaging endpoints
│   │   └── notifications.ts    # Notification endpoints
│   ├── components/             # Shared components
│   │   ├── AppHeader.tsx       # Header with nav icons
│   │   ├── AppNavbar.tsx       # Sidebar navigation
│   │   ├── RichTextEditor.tsx  # Tiptap editor
│   │   ├── ChatRichTextEditor.tsx # Chat-specific editor
│   │   └── EmojiPicker.tsx     # Emoji selector
│   ├── pages/                  # Page components
│   ├── store/                  # Zustand stores
│   │   └── authStore.ts        # Auth state management
│   ├── types/                  # TypeScript definitions
│   │   └── index.ts            # All type definitions
│   ├── hooks/                  # Custom React hooks
│   ├── utils/                  # Utility functions
│   ├── App.tsx                 # Root component with routes
│   ├── main.tsx                # Entry point
│   └── index.css               # Global styles
├── public/                     # Static assets
├── package.json
├── vite.config.ts              # Vite + PWA config
└── tsconfig.json               # TypeScript config
```

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linting
npm run lint
```

## Pages

| Page | Path | Description |
|------|------|-------------|
| LoginPage | `/login` | Email/password login |
| RegisterPage | `/register` | Registration with invitation |
| DashboardPage | `/` | Home with widgets |
| DirectoryPage | `/directory` | House listing with search |
| HouseDetailPage | `/houses/:id` | House with inhabitants |
| ProfilePage | `/profile/:id` | User profile view |
| ProfileEditPage | `/profile/edit` | Edit own profile |
| ForumPage | `/forum` | Forum subgroup list |
| SubgroupPage | `/forum/:slug` | Threads and documents |
| ThreadPage | `/forum/:slug/:id` | Thread with posts |
| AnnouncementsPage | `/announcements` | Community announcements |
| FoodPage | `/food` | Weekly menu and registration |
| FoodPreferencesPage | `/food/preferences` | Default meal preferences |
| FoodTicketsPage | `/food/tickets` | Food ticket trading |
| FoodTeamsPage | `/food/teams` | Food team management |
| MenuManagementPage | `/food/menus` | Admin menu editing |
| CalendarPage | `/calendar` | Month view calendar |
| MessagesPage | `/messages` | Direct messaging |
| NotificationsPage | `/notifications` | Notification center |

## Components

### AppHeader
Top navigation bar with:
- Mobile menu toggle
- Notifications bell with unread count
- Messages icon with unread count
- User menu (profile, settings, logout)

### AppNavbar
Sidebar navigation with:
- Main navigation links
- Food Teams submenu
- Notification badge
- Responsive collapse

### RichTextEditor
Tiptap-based rich text editor with:
- Bold, italic, underline, strikethrough
- Headings (H1-H3)
- Lists (bullet, ordered)
- Links
- Code blocks
- Block quotes

### ChatRichTextEditor
Compact editor for messaging with:
- Minimal toolbar
- Enter to send
- Shift+Enter for newline

## API Client

The API client (`src/api/client.ts`) handles:
- Base URL configuration
- JWT token injection
- Automatic token refresh on 401
- Response/error interceptors

```typescript
// Example usage
import { forumApi } from '@/api/forum';

// In a component with React Query
const { data: subgroups } = useQuery({
  queryKey: ['subgroups'],
  queryFn: forumApi.getSubgroups,
});
```

## State Management

### Auth Store (Zustand)
Manages authentication state:
- `user` - Current user object
- `accessToken`, `refreshToken` - JWT tokens
- `isAuthenticated` - Auth status
- `login()`, `logout()`, `updateUser()` - Actions

### React Query
Used for all server state:
- Automatic caching
- Background refetching
- Optimistic updates
- Invalidation on mutations

## Type Definitions

All types are in `src/types/index.ts`:
- User, House, UserSummary
- Subgroup, Thread, Post
- Announcement
- WeeklyMenu, DailyMenu, MealRegistration
- FoodTicket, FoodTeam, FoodTeamCycle
- CalendarEvent
- Conversation, Message
- Notification, NotificationPreference

## WebSocket Integration

Real-time features via WebSocket (`ws://localhost:7000/ws/chat/`):
- New message notifications
- Typing indicators
- Read receipts
- Live notification delivery

Connection managed in `AppHeader.tsx` with reconnection logic.

## Key Patterns

### Protected Routes
```typescript
// In App.tsx
<Route element={<ProtectedRoute />}>
  <Route path="/" element={<DashboardPage />} />
  {/* ... */}
</Route>
```

### Data Fetching
```typescript
// Query
const { data, isLoading, error } = useQuery({
  queryKey: ['resource', id],
  queryFn: () => api.getResource(id),
});

// Mutation
const mutation = useMutation({
  mutationFn: api.createResource,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  },
});
```

### Form Handling
Using Mantine's `useForm`:
```typescript
const form = useForm({
  initialValues: { title: '', content: '' },
  validate: {
    title: (value) => value.length < 1 ? 'Required' : null,
  },
});
```

## Environment

The frontend proxies API requests to the backend:
- `/api/*` -> `http://localhost:7000`
- `/media/*` -> `http://localhost:7000`
- `/ws/*` -> `ws://localhost:7000`

Configured in `vite.config.ts`.

## PWA Support

The app is installable as a PWA:
- Service worker for offline support
- Web app manifest
- Icon assets in `/public`
