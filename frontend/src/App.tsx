import { useEffect, useState } from "react"
import { Routes, Route, Navigate, useLocation } from "react-router-dom"
import { LoadingOverlay, AppShell } from "@mantine/core"
import * as Sentry from "@sentry/react"

// Wrapping Routes enables Sentry to name transactions by route pattern (e.g. /forum/:slug)
// instead of the raw URL, which makes the Performance dashboard far more useful.
const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)

import { useAuthStore } from "./store/authStore"
import { getAccessToken } from "./api/client"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { PageErrorBoundary } from "./components/PageErrorBoundary"
import { useVersionCheck } from "./hooks/useVersionCheck"
import { usePushSubscriptionSync } from "./hooks/usePushSubscriptionSync"

// Pages
import LoginPage from "./pages/LoginPage"
import RegisterPage from "./pages/RegisterPage"
import ForgotPasswordPage from "./pages/ForgotPasswordPage"
import ResetPasswordPage from "./pages/ResetPasswordPage"
import ChangePasswordPage from "./pages/ChangePasswordPage"
import DashboardPage from "./pages/DashboardPage"
import DirectoryPage from "./pages/DirectoryPage"
import HouseDetailPage from "./pages/HouseDetailPage"
import HouseEditPage from "./pages/HouseEditPage"
import ProfilePage from "./pages/ProfilePage"
import ProfileEditPage from "./pages/ProfileEditPage"
import ForumPage from "./pages/ForumPage"
import SubgroupPage from "./pages/SubgroupPage"
import ThreadPage from "./pages/ThreadPage"
import AnnouncementsPage from "./pages/AnnouncementsPage"
import FoodPage from "./pages/FoodPage"
import FoodPreferencesPage from "./pages/FoodPreferencesPage"
import FoodTicketsPage from "./pages/FoodTicketsPage"
import FoodTeamsPage from "./pages/FoodTeamsPage"
import CalendarPage from "./pages/CalendarPage"
import EventDetailPage from "./pages/EventDetailPage"
import EventFormPage from "./pages/EventFormPage"
import BookingsPage from "./pages/BookingsPage"
import LinksPage from "./pages/LinksPage"
import MessagesPage from "./pages/MessagesPage"
import NotificationsPage from "./pages/NotificationsPage"
import NotificationPreferencesPage from "./pages/NotificationPreferencesPage"
import AdminPage from "./pages/AdminPage"
import ConfirmEmailChangePage from "./pages/ConfirmEmailChangePage"
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage"
import AppHeader from "./components/AppHeader"
import AppNavbar from "./components/AppNavbar"
import { GlobalSearch } from "./components/GlobalSearch"
import { InstallPrompt } from "./components/InstallPrompt"
import { PushNotificationPrompt } from "./components/PushNotificationPrompt"

interface ProtectedRouteProps {
  children: React.ReactNode
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuthStore()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function App() {
  const { checkAuth, isAuthenticated } = useAuthStore()
  const [isInitializing, setIsInitializing] = useState(true)
  const [navbarOpened, setNavbarOpened] = useState(false)

  // Check for app updates when user returns to the app
  useVersionCheck()

  // Re-sync push subscription if it was invalidated (e.g. Android force-close)
  usePushSubscriptionSync()

  useEffect(() => {
    const initAuth = async () => {
      const token = getAccessToken()
      if (token) {
        await checkAuth()
      }
      setIsInitializing(false)
    }

    initAuth()
  }, [checkAuth])

  if (isInitializing) {
    return <LoadingOverlay visible />
  }

  // Public routes (login, register, password reset)
  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <SentryRoutes>
          <Route
            path="/login"
            element={
              <PageErrorBoundary>
                <LoginPage />
              </PageErrorBoundary>
            }
          />
          <Route
            path="/register"
            element={
              <PageErrorBoundary>
                <RegisterPage />
              </PageErrorBoundary>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PageErrorBoundary>
                <ForgotPasswordPage />
              </PageErrorBoundary>
            }
          />
          <Route
            path="/reset-password"
            element={
              <PageErrorBoundary>
                <ResetPasswordPage />
              </PageErrorBoundary>
            }
          />
          <Route
            path="/bekraeft-email"
            element={
              <PageErrorBoundary>
                <ConfirmEmailChangePage />
              </PageErrorBoundary>
            }
          />
          <Route
            path="/privatlivspolitik"
            element={
              <PageErrorBoundary>
                <PrivacyPolicyPage />
              </PageErrorBoundary>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </SentryRoutes>
      </ErrorBoundary>
    )
  }

  // Authenticated routes with app shell
  return (
    <ErrorBoundary>
      <GlobalSearch />
      <InstallPrompt />
      <PushNotificationPrompt />
      <AppShell
        header={{ height: 60 }}
        navbar={{
          width: 280,
          breakpoint: "sm",
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
          <SentryRoutes>
            {/* Forside */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <DashboardPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Beboere */}
            <Route
              path="/beboere"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <DirectoryPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/beboere/hus/:id"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <HouseDetailPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Profil */}
            <Route
              path="/profil"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ProfilePage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profil/rediger"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ProfileEditPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profil/skift-adgangskode"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ChangePasswordPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profil/:userId"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ProfilePage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Hus */}
            <Route
              path="/hus/rediger"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <HouseEditPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Forum */}
            <Route
              path="/forum"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ForumPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/:slug/lukkede"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <SubgroupPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/:slug/dokumenter/:folderSlug"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <SubgroupPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/:slug/dokumenter"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <SubgroupPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/:slug"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <SubgroupPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/:slug/traad/:threadSlug"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ThreadPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/forum/traad/:id"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <ThreadPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Opslag */}
            <Route
              path="/opslag"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <AnnouncementsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Mad */}
            <Route
              path="/mad"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mad/praeferencer"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodPreferencesPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mad/billetter"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodTicketsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/mad/:tab"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Madhold */}
            <Route
              path="/madhold"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodTeamsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/madhold/:tab"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <FoodTeamsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Kalender */}
            <Route
              path="/kalender"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <CalendarPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/kalender/opret"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <EventFormPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/kalender/:id"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <EventDetailPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/kalender/:id/rediger"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <EventFormPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Booking */}
            <Route
              path="/booking"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <BookingsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Nyttige links */}
            <Route
              path="/links"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <LinksPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Beskeder */}
            <Route
              path="/beskeder/:conversationId?"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <MessagesPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Notifikationer */}
            <Route
              path="/notifikationer/indstillinger"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <NotificationPreferencesPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifikationer"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <NotificationsPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />
            {/* Bekræft emailændring */}
            <Route
              path="/bekraeft-email"
              element={
                <PageErrorBoundary>
                  <ConfirmEmailChangePage />
                </PageErrorBoundary>
              }
            />

            {/* Drift */}
            <Route
              path="/drift"
              element={
                <ProtectedRoute>
                  <PageErrorBoundary>
                    <AdminPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }
            />

            {/* Privatlivspolitik */}
            <Route
              path="/privatlivspolitik"
              element={
                <PageErrorBoundary>
                  <PrivacyPolicyPage />
                </PageErrorBoundary>
              }
            />

            {/* Catch all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </SentryRoutes>
        </AppShell.Main>
      </AppShell>
    </ErrorBoundary>
  )
}

export default App
