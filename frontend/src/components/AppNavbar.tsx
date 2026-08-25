import { NavLink, Stack, ScrollArea, Badge, Group } from "@mantine/core"

import { useLocation, Link } from "react-router-dom"

import { useQuery } from "@tanstack/react-query"

import {
  IconHome,
  IconMessageCircle,
  IconCalendar,
  IconCar,
  IconSoup,
  IconSpeakerphone,
  IconUsers,
  IconBuildingCommunity,
  IconBell,
  IconDoor,
  IconLink,
  IconReceipt2,
  IconTool,
  IconSettings,
  IconUsersGroup,
} from "@tabler/icons-react"

import { forumApi } from "../api/forum"

import { messagingApi } from "../api/messaging"

import { notificationsApi } from "../api/notifications"

import { useAuthStore } from "../store/authStore"

import { isTestEnvironment } from "../utils/environment"

interface NavItem {
  icon: typeof IconHome

  label: string

  path: string

  color?: string
}

const navItems: NavItem[] = [
  { icon: IconHome, label: "Forside", path: "/" },

  { icon: IconUsers, label: "Beskeder", path: "/beskeder" },

  {
    icon: IconBell,

    label: "Notifikationer",

    path: "/notifikationer",
  },

  {
    icon: IconSpeakerphone,

    label: "Vigtig post",

    path: "/opslag",
  },

  { icon: IconMessageCircle, label: "Forum", path: "/forum" },

  { icon: IconSoup, label: "Mad", path: "/mad" },

  { icon: IconUsersGroup, label: "Madhold", path: "/madhold" },

  { icon: IconCalendar, label: "Begivenhedskalender", path: "/kalender" },

  {
    icon: IconBuildingCommunity,

    label: "Beboeroversigt",

    path: "/beboere",
  },

  { icon: IconDoor, label: "Bookingkalender", path: "/booking" },

  { icon: IconCar, label: "Bildeling", path: "/bildeling" },

  { icon: IconReceipt2, label: "Udlæg", path: "/udlaeg" },

  { icon: IconTool, label: "Indrapportering", path: "/indrapportering" },

  { icon: IconLink, label: "Nyttige links", path: "/links" },
]

// Features still being trialled: shown on local dev and the test site, kept off
// the real site until we are happy with them. Only the nav entry is hidden — the
// route and the API stay open, so this is discovery-hiding, not access control.
const TRIAL_ONLY_PATHS = ["/udlaeg", "/indrapportering"]

interface AppNavbarProps {
  onNavigate?: () => void
}

export default function AppNavbar({ onNavigate }: AppNavbarProps) {
  const location = useLocation()

  const user = useAuthStore((s) => s.user)

  // Fetch unread message count

  const { data: unreadMessagesData } = useQuery({
    queryKey: ["messages", "unread-count"],

    queryFn: messagingApi.getUnreadCount,

    refetchInterval: 30000,
  })

  // Fetch unread notification count

  const { data: unreadNotificationsData } = useQuery({
    queryKey: ["notifications", "unread-count"],

    queryFn: notificationsApi.getUnreadCount,

    refetchInterval: 30000,
  })

  // Fetch unread forum thread count

  const { data: unreadForumData } = useQuery({
    queryKey: ["forum", "unread-count"],

    queryFn: forumApi.getUnreadCount,

    refetchInterval: 30000,
  })

  const unreadMessages = unreadMessagesData?.unread_count ?? 0

  const unreadNotifications = unreadNotificationsData?.unread_count ?? 0

  const unreadForum = unreadForumData?.unread_count ?? 0

  const getLabel = (item: NavItem) => {
    let badgeCount = 0

    if (item.path === "/beskeder") badgeCount = unreadMessages

    if (item.path === "/notifikationer") badgeCount = unreadNotifications

    if (item.path === "/forum") badgeCount = unreadForum

    if (badgeCount > 0) {
      return (
        <Group gap="xs">
          {item.label}
          <Badge
            size="xs"
            color="red"
            style={{ minWidth: 18, paddingInline: 4 }}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </Badge>
        </Group>
      )
    }

    return item.label
  }

  const visibleNavItems = navItems.filter(
    (item) => !TRIAL_ONLY_PATHS.includes(item.path) || isTestEnvironment(),
  )

  return (
    <ScrollArea>
      <Stack gap={4}>
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.path}
            component={Link}
            to={item.path}
            label={getLabel(item)}
            leftSection={<item.icon size={20} />}
            active={
              item.path === "/"
                ? location.pathname === "/"
                : item.path === "/madhold"
                  ? location.pathname === "/madhold"
                  : item.path === "/mad"
                    ? location.pathname === "/mad" ||
                      location.pathname.startsWith("/mad/")
                    : location.pathname.startsWith(item.path)
            }
            onClick={onNavigate}
          />
        ))}
        {user?.is_staff && (
          <NavLink
            component={Link}
            to="/drift"
            label="Admin"
            leftSection={<IconSettings size={20} />}
            active={location.pathname === "/drift"}
            onClick={onNavigate}
          />
        )}
      </Stack>
    </ScrollArea>
  )
}
