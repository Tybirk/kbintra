import { NavLink, Stack, ScrollArea, Badge, Group } from "@mantine/core"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  IconHome,
  IconMessageCircle,
  IconCalendar,
  IconSoup,
  IconSpeakerphone,
  IconUsers,
  IconBuildingCommunity,
  IconBell,
  IconUsersGroup,
  IconDoor,
  IconLink,
} from "@tabler/icons-react"
import { forumApi } from "../api/forum"
import { messagingApi } from "../api/messaging"
import { notificationsApi } from "../api/notifications"

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
  { icon: IconCalendar, label: "Kalender", path: "/kalender" },
  {
    icon: IconBuildingCommunity,
    label: "Beboeroversigt",
    path: "/beboere",
  },
  { icon: IconDoor, label: "Booking", path: "/booking" },
  { icon: IconLink, label: "Nyttige links", path: "/links" },
]

interface AppNavbarProps {
  onNavigate?: () => void
}

export default function AppNavbar({ onNavigate }: AppNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()

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

  const handleNavigate = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  const getLabel = (item: NavItem) => {
    let badgeCount = 0
    if (item.path === "/beskeder") badgeCount = unreadMessages
    if (item.path === "/notifikationer") badgeCount = unreadNotifications
    if (item.path === "/forum") badgeCount = unreadForum

    if (badgeCount > 0) {
      return (
        <Group gap="xs">
          {item.label}
          <Badge size="xs" circle color="red">
            {badgeCount > 9 ? "9+" : badgeCount}
          </Badge>
        </Group>
      )
    }
    return item.label
  }

  return (
    <ScrollArea>
      <Stack gap={4}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
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
            onClick={() => handleNavigate(item.path)}
          />
        ))}
      </Stack>
    </ScrollArea>
  )
}
