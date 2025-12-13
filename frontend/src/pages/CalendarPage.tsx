import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Stack,
  Avatar,
  TextInput,
  Textarea,
  Modal,
  ActionIcon,
  Menu,
  Badge,
  Switch,
  SimpleGrid,
  Box,
  Indicator,
} from '@mantine/core';
import { Calendar, DateTimePicker } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconCalendarEvent,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconMapPin,
  IconChevronLeft,
  IconChevronRight,
} from '@tabler/icons-react';
import dayjs from 'dayjs';

import { calendarApi } from '../api/calendar';
import type { CalendarEvent, CreateEventData } from '../types';

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] =
    useDisclosure(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);
  const [eventToDelete, setEventToDelete] = useState<number | null>(null);

  // Fetch events for current month (with buffer)
  const startDate = dayjs(selectedMonth).startOf('month').subtract(7, 'day').toISOString();
  const endDate = dayjs(selectedMonth).endOf('month').add(7, 'day').toISOString();

  const { data: events, isLoading, error } = useQuery({
    queryKey: ['calendar', 'events', startDate, endDate],
    queryFn: () => calendarApi.getEvents(startDate, endDate),
  });

  const deleteMutation = useMutation({
    mutationFn: calendarApi.deleteEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      closeDeleteModal();
      setEventToDelete(null);
      notifications.show({
        title: 'Event deleted',
        message: 'The event has been deleted.',
        color: 'blue',
      });
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to delete event. Please try again.',
        color: 'red',
      });
    },
  });

  // Group events by date for the calendar indicator
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events?.forEach((event) => {
      const dateKey = dayjs(event.start_datetime).format('YYYY-MM-DD');
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });
    return map;
  }, [events]);

  // Events for the current month (displayed in list)
  const monthEvents = useMemo(() => {
    return events
      ?.filter((event) => {
        const eventDate = dayjs(event.start_datetime);
        return eventDate.month() === dayjs(selectedMonth).month() &&
               eventDate.year() === dayjs(selectedMonth).year();
      })
      .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
  }, [events, selectedMonth]);

  const handleDeleteClick = (id: number) => {
    setEventToDelete(id);
    openDeleteModal();
  };

  const handleConfirmDelete = () => {
    if (eventToDelete) {
      deleteMutation.mutate(eventToDelete);
    }
  };

  const goToPrevMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).subtract(1, 'month').toDate());
  };

  const goToNextMonth = () => {
    setSelectedMonth(dayjs(selectedMonth).add(1, 'month').toDate());
  };

  const goToToday = () => {
    setSelectedMonth(new Date());
  };

  if (error) {
    return (
      <Center h={200}>
        <Text c="red">Failed to load events. Please try again.</Text>
      </Center>
    );
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Calendar</Title>
          <Text c="dimmed">Community events and activities</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          New Event
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Calendar */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="md">
            <Group gap="xs">
              <ActionIcon variant="subtle" onClick={goToPrevMonth}>
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text fw={500}>
                {dayjs(selectedMonth).format('MMMM YYYY')}
              </Text>
              <ActionIcon variant="subtle" onClick={goToNextMonth}>
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
            <Button variant="subtle" size="xs" onClick={goToToday}>
              Today
            </Button>
          </Group>

          {isLoading ? (
            <Center h={300}>
              <Loader size="lg" />
            </Center>
          ) : (
            <Calendar
              date={selectedMonth}
              onDateChange={(date) => setSelectedMonth(new Date(date))}
              size="md"
              renderDay={(date) => {
                const dateValue = new Date(date);
                const dateKey = dayjs(dateValue).format('YYYY-MM-DD');
                const dayEvents = eventsByDate[dateKey];
                const day = dateValue.getDate();
                return (
                  <Indicator
                    size={6}
                    color="blue"
                    offset={-2}
                    disabled={!dayEvents?.length}
                  >
                    <div>{day}</div>
                  </Indicator>
                );
              }}
            />
          )}
        </Paper>

        {/* Events List */}
        <Paper withBorder p="md" radius="md">
          <Text fw={500} mb="md">
            Events in {dayjs(selectedMonth).format('MMMM YYYY')}
          </Text>

          {isLoading ? (
            <Center h={200}>
              <Loader size="md" />
            </Center>
          ) : monthEvents?.length === 0 ? (
            <Center h={200}>
              <Stack align="center" gap="xs">
                <IconCalendarEvent size={48} color="gray" />
                <Text c="dimmed">No events this month.</Text>
                <Button onClick={openCreateModal} mt="sm">
                  Create Event
                </Button>
              </Stack>
            </Center>
          ) : (
            <Stack gap="sm">
              {monthEvents?.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onEdit={() => setEditingEvent(event)}
                  onDelete={() => handleDeleteClick(event.id)}
                />
              ))}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      <CreateEventModal
        opened={createModalOpened}
        onClose={closeCreateModal}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['calendar'] });
          closeCreateModal();
        }}
      />

      {editingEvent && (
        <EditEventModal
          opened={!!editingEvent}
          onClose={() => setEditingEvent(null)}
          event={editingEvent}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
            setEditingEvent(null);
          }}
        />
      )}

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title="Delete Event"
        centered
      >
        <Text mb="lg">
          Are you sure you want to delete this event? This action cannot be undone.
        </Text>
        <Group justify="flex-end">
          <Button variant="light" onClick={closeDeleteModal}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={handleConfirmDelete}
            loading={deleteMutation.isPending}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  onEdit: () => void;
  onDelete: () => void;
}

function EventCard({ event, onEdit, onDelete }: EventCardProps) {
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), 'day');
  const isPast = dayjs(event.end_datetime).isBefore(dayjs());

  return (
    <Paper withBorder p="sm" radius="md" style={{ opacity: isPast ? 0.6 : 1 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
          <Box
            style={{
              width: 4,
              alignSelf: 'stretch',
              borderRadius: 2,
              backgroundColor: isToday ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-gray-4)',
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" mb={4}>
              <Text fw={500} truncate>
                {event.title}
              </Text>
              {event.is_all_day && (
                <Badge size="xs" variant="light">
                  All Day
                </Badge>
              )}
              {isToday && (
                <Badge size="xs" color="blue">
                  Today
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {event.is_all_day
                ? dayjs(event.start_datetime).format('ddd, MMM D')
                : `${dayjs(event.start_datetime).format('ddd, MMM D')} at ${dayjs(event.start_datetime).format('HH:mm')} - ${dayjs(event.end_datetime).format('HH:mm')}`}
            </Text>
            {event.location && (
              <Group gap={4} mt={4}>
                <IconMapPin size={14} color="gray" />
                <Text size="sm" c="dimmed" truncate>
                  {event.location}
                </Text>
              </Group>
            )}
            <Group gap="xs" mt={4}>
              <Avatar
                src={event.created_by.profile_picture}
                size="xs"
                radius="xl"
              >
                {event.created_by.first_name?.[0]}
              </Avatar>
              <Text size="xs" c="dimmed">
                {event.created_by.first_name} {event.created_by.last_name}
              </Text>
            </Group>
          </div>
        </Group>

        {event.is_own && (
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <ActionIcon variant="subtle">
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                Edit
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={onDelete}
              >
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Paper>
  );
}

interface CreateEventModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function CreateEventModal({ opened, onClose, onSuccess }: CreateEventModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [startDatetime, setStartDatetime] = useState<Date | null>(null);
  const [endDatetime, setEndDatetime] = useState<Date | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: CreateEventData) => calendarApi.createEvent(data),
    onSuccess: () => {
      notifications.show({
        title: 'Event created',
        message: 'Your event has been added to the calendar.',
        color: 'green',
      });
      resetForm();
      onSuccess();
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to create event. Please try again.',
        color: 'red',
      });
    },
  });

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setLocation('');
    setIsAllDay(false);
    setStartDatetime(null);
    setEndDatetime(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDatetime || !endDatetime) return;

    createMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      is_all_day: isAllDay,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title="Create Event" size="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Description"
            placeholder="Event description (optional)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <TextInput
            label="Location"
            placeholder="Event location (optional)"
            leftSection={<IconMapPin size={16} />}
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />

          <Switch
            label="All day event"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.currentTarget.checked)}
          />

          <DateTimePicker
            label="Start"
            placeholder="Select start date and time"
            value={startDatetime}
            onChange={(value) => setStartDatetime(value ? new Date(value) : null)}
            withSeconds={false}
            required
          />

          <DateTimePicker
            label="End"
            placeholder="Select end date and time"
            value={endDatetime}
            onChange={(value) => setEndDatetime(value ? new Date(value) : null)}
            withSeconds={false}
            minDate={startDatetime || undefined}
            required
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              disabled={!title.trim() || !startDatetime || !endDatetime}
            >
              Create Event
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface EditEventModalProps {
  opened: boolean;
  onClose: () => void;
  event: CalendarEvent;
  onSuccess: () => void;
}

function EditEventModal({ opened, onClose, event, onSuccess }: EditEventModalProps) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [location, setLocation] = useState(event.location);
  const [isAllDay, setIsAllDay] = useState(event.is_all_day);
  const [startDatetime, setStartDatetime] = useState<Date | null>(
    new Date(event.start_datetime)
  );
  const [endDatetime, setEndDatetime] = useState<Date | null>(
    new Date(event.end_datetime)
  );

  const updateMutation = useMutation({
    mutationFn: (data: CreateEventData) => calendarApi.updateEvent(event.id, data),
    onSuccess: () => {
      notifications.show({
        title: 'Event updated',
        message: 'Your event has been updated.',
        color: 'green',
      });
      onSuccess();
    },
    onError: () => {
      notifications.show({
        title: 'Error',
        message: 'Failed to update event. Please try again.',
        color: 'red',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDatetime || !endDatetime) return;

    updateMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      is_all_day: isAllDay,
      start_datetime: startDatetime.toISOString(),
      end_datetime: endDatetime.toISOString(),
    });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Edit Event" size="md">
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Description"
            placeholder="Event description (optional)"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
          />

          <TextInput
            label="Location"
            placeholder="Event location (optional)"
            leftSection={<IconMapPin size={16} />}
            value={location}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />

          <Switch
            label="All day event"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.currentTarget.checked)}
          />

          <DateTimePicker
            label="Start"
            placeholder="Select start date and time"
            value={startDatetime}
            onChange={(value) => setStartDatetime(value ? new Date(value) : null)}
            withSeconds={false}
            required
          />

          <DateTimePicker
            label="End"
            placeholder="Select end date and time"
            value={endDatetime}
            onChange={(value) => setEndDatetime(value ? new Date(value) : null)}
            withSeconds={false}
            minDate={startDatetime || undefined}
            required
          />

          <Group justify="flex-end">
            <Button variant="light" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={!title.trim() || !startDatetime || !endDatetime}
            >
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
