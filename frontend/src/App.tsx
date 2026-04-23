import { lazy, Suspense, useEffect, useState } from "react"

import { Routes, Route, Navigate, useLocation } from "react-router-dom"

import { LoadingOverlay, AppShell } from "@mantine/core"

import * as Sentry from "@sentry/react"

// Wrapping Routes enables Sentry to name transactions by route pattern (e.g. /forum/:slug)

// instead of the raw URL, which makes the Performance dashboard far more useful.

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)

import { useAuthStore } from "./store/authStore"

import { getAccessToken } from "./api/client"

import { trackNavigation } from "./utils/navigationHistory"

import { ErrorBoundary } from "./components/ErrorBoundary"

import { useVersionCheck } from "./hooks/useVersionCheck"

import { usePushSubscriptionSync } from "./hooks/usePushSubscriptionSync"

import { useAccessibilityModeSync } from "./hooks/useAccessibilityMode"

// Eager-loaded pages (most used)

import DashboardPage from "./pages/DashboardPage"

import ForumPage from "./pages/ForumPage"

import SubgroupPage from "./pages/SubgroupPage"

import ThreadPage from "./pages/ThreadPage"

import MessagesPage from "./pages/MessagesPage"

import LinksPage from "./pages/LinksPage"

import NotificationsPage from "./pages/NotificationsPage"

// Lazy-loaded pages

const LoginPage = lazy(() => import("./pages/LoginPage"))

const RegisterPage = lazy(() => import("./pages/RegisterPage"))

const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"))

const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"))

const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"))

const DirectoryPage = lazy(() => import("./pages/DirectoryPage"))

const HouseDetailPage = lazy(() => import("./pages/HouseDetailPage"))

const HouseEditPage = lazy(() => import("./pages/HouseEditPage"))

const ProfilePage = lazy(() => import("./pages/ProfilePage"))

const ProfileEditPage = lazy(() => import("./pages/ProfileEditPage"))

const AnnouncementsPage = lazy(() => import("./pages/AnnouncementsPage"))

const FoodPage = lazy(() => import("./pages/FoodPage"))

const FoodPreferencesPage = lazy(() => import("./pages/FoodPreferencesPage"))

const FoodTeamsPage = lazy(() => import("./pages/FoodTeamsPage"))

const CalendarPage = lazy(() => import("./pages/CalendarPage"))

const EventDetailPage = lazy(() => import("./pages/EventDetailPage"))

const EventFormPage = lazy(() => import("./pages/EventFormPage"))

const BookingsPage = lazy(() => import("./pages/BookingsPage"))

const NotificationPreferencesPage = lazy(
  () => import("./pages/NotificationPreferencesPage"),
)

const AdminPage = lazy(() => import("./pages/AdminPage"))

const ConfirmEmailChangePage = lazy(
  () => import("./pages/ConfirmEmailChangePage"),
)

const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"))

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

  const location = useLocation()

  useEffect(() => {
    trackNavigation(location.pathname)

    setNavbarOpened(false)
  }, [location.pathname])

  // Check for app updates when user returns to the app

  useVersionCheck()

  // Re-sync push subscription if it was invalidated (e.g. Android force-close)

  usePushSubscriptionSync()

  // Apply the user's accessibility preference from DB on every page, not only Min profil.

  useAccessibilityModeSync()

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
        <Suspense fallback={<LoadingOverlay visible />}>
          <SentryRoutes>
            <Route
              path="/login"
              element={
                <ErrorBoundary>
                  <LoginPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/register"
              element={
                <ErrorBoundary>
                  <RegisterPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <ErrorBoundary>
                  <ForgotPasswordPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/reset-password"
              element={
                <ErrorBoundary>
                  <ResetPasswordPage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/bekraeft-email"
              element={
                <ErrorBoundary>
                  <ConfirmEmailChangePage />
                </ErrorBoundary>
              }
            />
            <Route
              path="/privatlivspolitik"
              element={
                <ErrorBoundary>
                  <PrivacyPolicyPage />
                </ErrorBoundary>
              }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </SentryRoutes>
        </Suspense>
      </ErrorBoundary>
    )
  }

  // Authenticated routes with app shell

  return (
    <ErrorBoundary>
      <GlobalSearch onAction={() => setNavbarOpened(false)} />
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

        <AppShell.Main
          style={
            location.pathname.startsWith("/beskeder")
              ? { height: "100dvh", overflow: "hidden" }
              : undefined
          }
        >
          <Suspense fallback={<LoadingOverlay visible />}>
            <SentryRoutes>
              {/* Forside */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <DashboardPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Beboere */}
              <Route
                path="/beboere"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <DirectoryPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/beboere/hus/:id"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <HouseDetailPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Profil */}
              <Route
                path="/profil"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ProfilePage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profil/rediger"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ProfileEditPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profil/skift-adgangskode"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ChangePasswordPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profil/:userId"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ProfilePage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Hus */}
              <Route
                path="/hus/rediger"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <HouseEditPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Forum */}
              <Route
                path="/forum"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ForumPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug/lukkede"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <SubgroupPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug/dokumenter/:folderSlug"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <SubgroupPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug/dokumenter"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <SubgroupPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug/info"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <SubgroupPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <SubgroupPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/:slug/traad/:threadSlug"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ThreadPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/forum/traad/:id"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <ThreadPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Opslag */}
              <Route
                path="/opslag"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <AnnouncementsPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Mad */}
              <Route
                path="/mad"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <FoodPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mad/praeferencer"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <FoodPreferencesPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mad/:tab"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <FoodPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Madhold */}
              <Route
                path="/madhold"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <FoodTeamsPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/madhold/:tab"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <FoodTeamsPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Kalender */}
              <Route
                path="/kalender"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <CalendarPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/kalender/opret"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <EventFormPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/kalender/:slug"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <EventDetailPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/kalender/:slug/rediger"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <EventFormPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Booking */}
              <Route
                path="/booking"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <BookingsPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Nyttige links */}
              <Route
                path="/links"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <LinksPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Beskeder */}
              <Route
                path="/beskeder/:conversationId?"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <MessagesPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Notifikationer */}
              <Route
                path="/notifikationer/indstillinger"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <NotificationPreferencesPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/notifikationer"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <NotificationsPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />
              {/* Bekræft emailændring */}
              <Route
                path="/bekraeft-email"
                element={
                  <ErrorBoundary>
                    <ConfirmEmailChangePage />
                  </ErrorBoundary>
                }
              />

              {/* Drift */}
              <Route
                path="/drift"
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>
                      <AdminPage />
                    </ErrorBoundary>
                  </ProtectedRoute>
                }
              />

              {/* Privatlivspolitik */}
              <Route
                path="/privatlivspolitik"
                element={
                  <ErrorBoundary>
                    <PrivacyPolicyPage />
                  </ErrorBoundary>
                }
              />

              {/* Catch all */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </SentryRoutes>
          </Suspense>
        </AppShell.Main>
      </AppShell>
    </ErrorBoundary>
  )
}

export default App
