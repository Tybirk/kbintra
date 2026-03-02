import { useNavigate } from "react-router-dom"
import { Paper, Group, Box, Text, Badge, Avatar } from "@mantine/core"
import { IconMapPin } from "@tabler/icons-react"
import dayjs from "dayjs"
import type { Event } from "../types"

interface CompactEventCardProps {
  event: Event
  showCreator?: boolean
}

export function CompactEventCard({
  event,
  showCreator = false,
}: CompactEventCardProps) {
  const navigate = useNavigate()
  const isToday = dayjs(event.start_datetime).isSame(dayjs(), "day")
  const isPast = dayjs(event.end_datetime).isBefore(dayjs())
  const isMultiDay = !dayjs(event.start_datetime).isSame(
    dayjs(event.end_datetime),
    "day",
  )

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      style={{
        opacity: event.is_cancelled ? 0.5 : isPast ? 0.6 : 1,
        cursor: "pointer",
      }}
      onClick={() => navigate(`/kalender/${event.slug}`)}
    >
      <Group gap="sm" wrap="nowrap" style={{ flex: 1 }}>
        <Box
          style={{
            width: 4,
            alignSelf: "stretch",
            borderRadius: 2,
            backgroundColor: event.is_cancelled
              ? "var(--mantine-color-red-4)"
              : event.rooms[0]?.color
                ? event.rooms[0].color
                : isToday
                  ? "var(--mantine-color-blue-6)"
                  : event.visibility === "private"
                    ? "var(--mantine-color-gray-4)"
                    : "var(--mantine-color-blue-4)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text
              fw={500}
              truncate
              style={
                event.is_cancelled
                  ? { textDecoration: "line-through" }
                  : undefined
              }
            >
              {event.title}
            </Text>
            {event.is_cancelled && (
              <Badge size="xs" color="red">
                Aflyst
              </Badge>
            )}
            {isToday && !event.is_cancelled && (
              <Badge size="xs" color="blue">
                I dag
              </Badge>
            )}
            {event.visibility === "private" && (
              <Badge size="xs" variant="light" color="gray">
                Privat
              </Badge>
            )}
            {isMultiDay && (
              <Badge size="xs" variant="light" color="cyan">
                Flerdages
              </Badge>
            )}
            {event.rsvp_enabled &&
              event.rsvp_summary &&
              !event.is_cancelled && (
                <Badge size="xs" variant="light" color="grape">
                  {event.rsvp_summary.attending} deltager
                </Badge>
              )}
          </Group>
          <Text size="sm" c="dimmed">
            {dayjs(event.start_datetime).isSame(
              dayjs(event.end_datetime),
              "day",
            )
              ? `${dayjs(event.start_datetime).format("ddd D. MMM")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("HH:mm")}`
              : `${dayjs(event.start_datetime).format("ddd D. MMM")} kl. ${dayjs(event.start_datetime).format("HH:mm")} – ${dayjs(event.end_datetime).format("ddd D. MMM")} kl. ${dayjs(event.end_datetime).format("HH:mm")}`}
          </Text>
          {event.resolved_location && (
            <Group gap={4} mt={4}>
              <IconMapPin size={14} color="gray" />
              <Text size="sm" c="dimmed" truncate>
                {event.resolved_location}
              </Text>
            </Group>
          )}
          {showCreator && (
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
          )}
        </div>
      </Group>
    </Paper>
  )
}
