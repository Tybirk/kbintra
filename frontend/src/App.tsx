import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LoadingOverlay, AppShell } from '@mantine/core';

import { useAuthStore } from './store/authStore';
import { getAccessToken } from './api/client';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
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

  // Public routes (login, register, password reset)
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
          {/* Forside */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />

          {/* Beboere */}
          <Route
            path="/beboere"
            element={
              <ProtectedRoute>
                <DirectoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/beboere/hus/:id"
            element={
              <ProtectedRoute>
                <HouseDetailPage />
              </ProtectedRoute>
            }
          />

          {/* Profil */}
          <Route
            path="/profil"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profil/rediger"
            element={
              <ProtectedRoute>
                <ProfileEditPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profil/skift-adgangskode"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profil/:userId"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Hus */}
          <Route
            path="/hus/rediger"
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
            path="/forum/traad/:id"
            element={
              <ProtectedRoute>
                <ThreadPage />
              </ProtectedRoute>
            }
          />

          {/* Opslag */}
          <Route
            path="/opslag"
            element={
              <ProtectedRoute>
                <AnnouncementsPage />
              </ProtectedRoute>
            }
          />

          {/* Mad */}
          <Route
            path="/mad"
            element={
              <ProtectedRoute>
                <FoodPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mad/praeferencer"
            element={
              <ProtectedRoute>
                <FoodPreferencesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mad/billetter"
            element={
              <ProtectedRoute>
                <FoodTicketsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mad/admin"
            element={
              <ProtectedRoute>
                <MenuManagementPage />
              </ProtectedRoute>
            }
          />

          {/* Madhold */}
          <Route
            path="/madhold"
            element={
              <ProtectedRoute>
                <FoodTeamsPage />
              </ProtectedRoute>
            }
          />

          {/* Kalender */}
          <Route
            path="/kalender"
            element={
              <ProtectedRoute>
                <CalendarPage />
              </ProtectedRoute>
            }
          />

          {/* Beskeder */}
          <Route
            path="/beskeder"
            element={
              <ProtectedRoute>
                <MessagesPage />
              </ProtectedRoute>
            }
          />

          {/* Notifikationer */}
          <Route
            path="/notifikationer"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/indstillinger" element={<ComingSoon title="Indstillinger" />} />

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
