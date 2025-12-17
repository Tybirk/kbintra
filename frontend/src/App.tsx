import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LoadingOverlay, AppShell } from '@mantine/core';

import { useAuthStore } from './store/authStore';
import { getAccessToken } from './api/client';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import DirectoryPage from './pages/DirectoryPage';
import HouseDetailPage from './pages/HouseDetailPage';
import HouseEditPage from './pages/HouseEditPage';
import ProfilePage from './pages/ProfilePage';
import ProfileEditPage from './pages/ProfileEditPage';
import ForumPage from './pages/ForumPage';
import SubgroupPage from './pages/SubgroupPage';
import ThreadPage from './pages/ThreadPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import FoodPage from './pages/FoodPage';
import FoodPreferencesPage from './pages/FoodPreferencesPage';
import FoodTicketsPage from './pages/FoodTicketsPage';
import FoodTeamsPage from './pages/FoodTeamsPage';
import MenuManagementPage from './pages/MenuManagementPage';
import CalendarPage from './pages/CalendarPage';
import MessagesPage from './pages/MessagesPage';
import NotificationsPage from './pages/NotificationsPage';
import AppHeader from './components/AppHeader';
import AppNavbar from './components/AppNavbar';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);
  const [navbarOpened, setNavbarOpened] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      const token = getAccessToken();
      if (token) {
        await checkAuth();
      }
      setIsInitializing(false);
    };

    initAuth();
  }, [checkAuth]);

  if (isInitializing) {
    return <LoadingOverlay visible />;
  }

  // Public routes (login, register)
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Authenticated routes with app shell
  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 280,
        breakpoint: 'sm',
        collapsed: { mobile: !navbarOpened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader
          navbarOpened={navbarOpened}
          toggleNavbar={() => setNavbarOpened((o) => !o)}
        />
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AppNavbar onNavigate={() => setNavbarOpened(false)} />
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          {/* Dashboard */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          {/* Directory */}
          <Route
            path="/directory"
            element={
              <ProtectedRoute>
                <DirectoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/directory/house/:id"
            element={
              <ProtectedRoute>
                <HouseDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Profile */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/edit"
            element={
              <ProtectedRoute>
                <ProfileEditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/:userId"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* House Edit */}
          <Route
            path="/house/edit"
            element={
              <ProtectedRoute>
                <HouseEditPage />
              </ProtectedRoute>
            }
          />

          {/* Forum */}
          <Route
            path="/forum"
            element={
              <ProtectedRoute>
                <ForumPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/forum/:slug"
            element={
              <ProtectedRoute>
                <SubgroupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/forum/thread/:id"
            element={
              <ProtectedRoute>
                <ThreadPage />
              </ProtectedRoute>
            }
          />

          {/* Announcements */}
          <Route
            path="/announcements"
            element={
              <ProtectedRoute>
                <AnnouncementsPage />
              </ProtectedRoute>
            }
          />

          {/* Food */}
          <Route
            path="/food"
            element={
              <ProtectedRoute>
                <FoodPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/food/preferences"
            element={
              <ProtectedRoute>
                <FoodPreferencesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/food/tickets"
            element={
              <ProtectedRoute>
                <FoodTicketsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/food/manage"
            element={
              <ProtectedRoute>
                <MenuManagementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/food/teams"
            element={
              <ProtectedRoute>
                <FoodTeamsPage />
              </ProtectedRoute>
            }
          />

          {/* Calendar */}
          <Route
            path="/calendar"
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            }
          />
          {/* Messages */}
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <MessagesPage />
              </ProtectedRoute>
            }
          />

          {/* Notifications */}
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/settings" element={<ComingSoon title="Settings" />} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

// Placeholder component for future features
function ComingSoon({ title }: { title: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <h1>{title}</h1>
      <p style={{ color: 'gray' }}>This feature is coming soon!</p>
    </div>
  );
}

export default App;
