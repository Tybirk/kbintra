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
  IconLogout,
  IconUser,
  IconChevronDown,
  IconBell,
  IconMail,
  IconHome,
  IconSearch,
} from "@tabler/icons-react"
import { useNavigate, useLocation } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { notifications } from "@mantine/notifications"

import { useAuthStore } from "../store/authStore"
import { spotlight, focusSpotlightSearch } from "./GlobalSearch"
import { notificationsApi } from "../api/notifications"
import { chatWs, messagingApi } from "../api/messaging"
import { invalidateCacheForLink } from "../utils/cacheInvalidation"
import type { WsMessage } from "../types"

interface AppHeaderProps {
  navbarOpened: boolean
  toggleNavbar: () => void
}

export default function AppHeader({
  navbarOpened,
  toggleNavbar,
}: AppHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
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

  // Connect shared WebSocket for real-time notifications
  useEffect(() => {
    if (!user) return

    chatWs.connect()

    const unsubConnection = chatWs.onConnectionChange((connected) => {
      if (connected) {
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
        queryClient.invalidateQueries({
          queryKey: ["messages", "unread-count"],
        })
      }
    })

    const unsubMessage = chatWs.onMessage((data) => {
      const wsData = data as WsMessage

      if (wsData.type === "new_notification") {
        queryClient.invalidateQueries({
          queryKey: ["notifications", "unread-count"],
        })
        queryClient.invalidateQueries({ queryKey: ["notifications"] })

        const notificationLink = wsData.notification.link
        const notificationPathname = notificationLink?.split("#")[0]
        const isAlreadyViewing =
          notificationPathname && location.pathname === notificationPathname

        // Invalidate cached data so the destination page shows fresh content
        if (notificationLink) {
          invalidateCacheForLink(queryClient, notificationLink)
        }

        // If already on the destination page, mark the notification as read immediately
        if (isAlreadyViewing && notificationPathname) {
          void notificationsApi.markReadByLink(notificationPathname)
        }

        if (!isAlreadyViewing) {
          notifications.show({
            title: wsData.notification.title,
            message: wsData.notification.message,
            color: "blue",
            autoClose: 5000,
            onClick: () => {
              if (notificationLink) {
                navigate(notificationLink)
              } else {
                navigate("/notifikationer")
              }
            },
          })
        }
      }

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
  }, [queryClient, navigate, location.pathname, user])

  const handleLogout = () => {
    chatWs.disconnect()
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
          onClick={() => {
            // iOS/PWA: focus() is only allowed synchronously within a gesture handler.
            // We focus a temporary off-screen input immediately (opens keyboard), open
            // the spotlight, then transfer focus once its input is in the DOM.
            // Since focus is never lost, the keyboard stays open throughout.
            if (navigator.maxTouchPoints > 0) {
              const tmp = document.createElement("input")
              tmp.setAttribute("type", "text")
              tmp.style.cssText =
                "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;"
              document.body.appendChild(tmp)
              tmp.focus()
              spotlight.open()
              setTimeout(() => {
                focusSpotlightSearch()
                tmp.remove()
              }, 0)
            } else {
              spotlight.open()
            }
          }}
          w="100%"
          style={{
            display: "flex",
            alignItems: "center",
            gap: rem(8),
            padding: `${rem(8)} ${rem(14)}`,
            borderRadius: rem(8),
            backgroundColor: "var(--mantine-color-default-hover)",
            border: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <IconSearch
            size={18}
            style={{ color: "var(--mantine-color-gray-6)" }}
          />
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
