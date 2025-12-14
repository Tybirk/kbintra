import { NavLink, Stack, ScrollArea, Badge, Group } from '@mantine/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
} from '@tabler/icons-react';
import { messagingApi } from '../api/messaging';
import { notificationsApi } from '../api/notifications';

interface NavItem {
  icon: typeof IconHome;
  label: string;
  path: string;
  color?: string;
}

const navItems: NavItem[] = [
  { icon: IconHome, label: 'Forside', path: '/' },
  { icon: IconBell, label: 'Notifikationer', path: '/notifications', color: 'red' },
  { icon: IconSpeakerphone, label: 'Opslag', path: '/announcements', color: 'orange' },
  { icon: IconMessageCircle, label: 'Forum', path: '/forum', color: 'blue' },
  { icon: IconSoup, label: 'Mad', path: '/food', color: 'green' },
  { icon: IconUsersGroup, label: 'Madhold', path: '/food/teams', color: 'teal' },
  { icon: IconCalendar, label: 'Kalender', path: '/calendar', color: 'violet' },
  { icon: IconBuildingCommunity, label: 'Beboeroversigt', path: '/directory', color: 'yellow' },
  { icon: IconUsers, label: 'Beskeder', path: '/messages', color: 'cyan' },
];

interface AppNavbarProps {
  onNavigate?: () => void;
}

export default function AppNavbar({ onNavigate }: AppNavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch unread message count
  const { data: unreadMessagesData } = useQuery({
    queryKey: ['messages', 'unread-count'],
    queryFn: messagingApi.getUnreadCount,
    refetchInterval: 30000,
  });

  // Fetch unread notification count
  const { data: unreadNotificationsData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: 30000,
  });

  const unreadMessages = unreadMessagesData?.unread_count ?? 0;
  const unreadNotifications = unreadNotificationsData?.unread_count ?? 0;

  const handleNavigate = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const getLabel = (item: NavItem) => {
    let badgeCount = 0;
    if (item.path === '/messages') badgeCount = unreadMessages;
    if (item.path === '/notifications') badgeCount = unreadNotifications;

    if (badgeCount > 0) {
      return (
        <Group gap="xs">
          {item.label}
          <Badge size="xs" circle color="red">
            {badgeCount > 9 ? '9+' : badgeCount}
          </Badge>
        </Group>
      );
    }
    return item.label;
  };

  return (
    <ScrollArea>
      <Stack gap={4}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            label={getLabel(item)}
            leftSection={<item.icon size={20} />}
            active={
              item.path === '/'
                ? location.pathname === '/'
                : item.path === '/food/teams'
                  ? location.pathname === '/food/teams'
                  : location.pathname.startsWith(item.path)
            }
            onClick={() => handleNavigate(item.path)}
            color={item.color}
          />
        ))}
      </Stack>
    </ScrollArea>
  );
}
