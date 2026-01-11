import { useEffect } from "react"
import {
  Group,
  Burger,
  Text,
  Avatar,
  Menu,
  UnstyledButton,
  ActionIcon,
  Indicator,
  rem,
  Kbd,
  Box,
} from "@mantine/core"
import {
  IconSettings,
  IconLogout,
  IconUser,
  IconChevronDown,
  IconBell,
  IconMail,
  IconHome,
  IconSearch,
} from "@tabler/icons-react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { notifications } from "@mantine/notifications"

import { useAuthStore } from "../store/authStore"
import { spotlight } from "./GlobalSearch"
import { notificationsApi } from "../api/notifications"
import { ChatWebSocket, messagingApi } from "../api/messaging"
import { getAccessToken } from "../api/client"
import type { WsMessage } from "../types"

// Global WebSocket instance for notifications
const notificationWs = new ChatWebSocket(getAccessToken)

interface AppHeaderProps {
  navbarOpened: boolean
  toggleNavbar: () => void
}

export default function AppHeader({
  navbarOpened,
  toggleNavbar,
}: AppHeaderProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, logout } = useAuthStore()

  const { data: unreadNotificationsData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const { data: unreadMessagesData } = useQuery({
    queryKey: ["messages", "unread-count"],
    queryFn: messagingApi.getUnreadCount,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const unreadNotificationsCount = unreadNotificationsData?.unread_count ?? 0
  const unreadMessagesCount = unreadMessagesData?.unread_count ?? 0

  // Connect to WebSocket for real-time notifications
  useEffect(() => {
    notificationWs.connect()

    const unsubConnection = notificationWs.onConnectionChange((connected) => {
      if (!connected) {
        notifications.show({
          id: "ws-disconnected",
          title: "Forbindelse afbrudt",
          message: "Forsøger at genoprette forbindelsen...",
          color: "yellow",
          autoClose: false,
        })
      } else {
        notifications.hide("ws-disconnected")
        // Refresh data when reconnected
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
        queryClient.invalidateQueries({
          queryKey: ["messages", "unread-count"],
        })
      }
    })

    const unsubMessage = notificationWs.onMessage((data) => {
      const wsData = data as WsMessage

      if (wsData.type === "new_notification") {
        // Update notification count
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
        queryClient.invalidateQueries({ queryKey: ["notifications"] })

        // Show toast notification
        notifications.show({
          title: wsData.notification.title,
          message: wsData.notification.message,
          color: "blue",
          autoClose: 5000,
          onClick: () => {
            if (wsData.notification.link) {
              navigate(wsData.notification.link)
            } else {
              navigate("/notifikationer")
            }
          },
        })
      }

      // Update messages unread count when receiving new messages
      if (wsData.type === "new_message") {
        queryClient.invalidateQueries({
          queryKey: ["messages", "unread-count"],
        })
      }
    })

    return () => {
      unsubConnection()
      unsubMessage()
    }
  }, [queryClient, navigate])

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  return (
    <Group h="100%" px="md" gap="md" wrap="nowrap">
      {/* Left section: burger + logo */}
      <Group gap="xs" wrap="nowrap">
        <Burger
          opened={navbarOpened}
          onClick={toggleNavbar}
          hiddenFrom="sm"
          size="sm"
        />
        <Text fw={700} size="lg" visibleFrom="xs">
          KB Intra
        </Text>
      </Group>

      {/* Center section: search bar (grows to fill space) */}
      <Box style={{ flex: 1, maxWidth: rem(500) }} mx="auto">
        <UnstyledButton
          onClick={() => spotlight.open()}
          w="100%"
          style={{
            display: "flex",
            alignItems: "center",
            gap: rem(8),
            padding: `${rem(8)} ${rem(14)}`,
            borderRadius: rem(8),
            backgroundColor: "var(--mantine-color-gray-1)",
            border: "1px solid var(--mantine-color-gray-3)",
          }}
        >
          <IconSearch size={18} style={{ color: "var(--mantine-color-gray-6)" }} />
          <Text size="sm" c="dimmed" style={{ flex: 1 }}>
            Søg...
          </Text>
          <Kbd size="xs" visibleFrom="sm">
            ⌘K
          </Kbd>
        </UnstyledButton>
      </Box>

      {/* Right section: icons + user menu */}
      <Group gap="sm" wrap="nowrap">
        <Indicator
          color="red"
          size={18}
          label={unreadMessagesCount > 99 ? "99+" : unreadMessagesCount}
          disabled={unreadMessagesCount === 0}
          offset={4}
        >
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={() => navigate("/beskeder")}
            aria-label="Beskeder"
          >
            <IconMail size={22} />
          </ActionIcon>
        </Indicator>

        <Indicator
          color="red"
          size={18}
          label={
            unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount
          }
          disabled={unreadNotificationsCount === 0}
          offset={4}
        >
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={() => navigate("/notifikationer")}
            aria-label="Notifikationer"
          >
            <IconBell size={22} />
          </ActionIcon>
        </Indicator>

        <Menu shadow="md" width={200} position="bottom-end">
          <Menu.Target>
            <UnstyledButton>
              <Group gap="xs" wrap="nowrap">
                <Avatar
                  src={user?.profile_picture}
                  alt={user?.first_name}
                  radius="xl"
                  size="sm"
                >
                  {user?.first_name?.[0]}
                  {user?.last_name?.[0]}
                </Avatar>
                <Box visibleFrom="sm">
                  <Text size="sm" fw={500}>
                    {user?.first_name} {user?.last_name}
                  </Text>
                </Box>
                <IconChevronDown size={14} />
              </Group>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Item
              leftSection={
                <IconUser style={{ width: rem(14), height: rem(14) }} />
              }
              onClick={() => navigate("/profil")}
            >
              Min profil
            </Menu.Item>
            {user?.house && (
              <Menu.Item
                leftSection={
                  <IconHome style={{ width: rem(14), height: rem(14) }} />
                }
                onClick={() => navigate("/hus/rediger")}
              >
                Mit hus
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={
                <IconSettings style={{ width: rem(14), height: rem(14) }} />
              }
              onClick={() => navigate("/indstillinger")}
            >
              Indstillinger
            </Menu.Item>

            <Menu.Divider />

            <Menu.Item
              color="red"
              leftSection={
                <IconLogout style={{ width: rem(14), height: rem(14) }} />
              }
              onClick={handleLogout}
            >
              Log ud
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  )
}
