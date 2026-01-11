import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  Loader,
  Center,
  Stack,
  Badge,
  Select,
  SimpleGrid,
  Alert,
  ActionIcon,
  Divider,
} from "@mantine/core"
import { notifications } from "@mantine/notifications"
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconAlertCircle,
} from "@tabler/icons-react"
import dayjs from "dayjs"
import isoWeek from "dayjs/plugin/isoWeek"

dayjs.extend(isoWeek)

import { foodApi } from "../api/food"
import type { MenuTemplate, DailyMenu } from "../types"

export default function MenuManagementPage() {
  const queryClient = useQueryClient()

  // Start from current week
  const today = dayjs()
  const [weekOffset, setWeekOffset] = useState(0)
  const selectedWeekStart = today
    .startOf("isoWeek")
    .add(weekOffset, "week")
  const weekStartStr = selectedWeekStart.format("YYYY-MM-DD")

  const { data: menus, isLoading: menusLoading } = useQuery({
    queryKey: ["food", "menus"],
    queryFn: foodApi.getWeeklyMenus,
  })

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ["food", "templates"],
    queryFn: foodApi.getTemplates,
  })

  const createMenuMutation = useMutation({
    mutationFn: (weekStartDate: string) =>
      foodApi.createWeeklyMenu(weekStartDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "menus"] })
      notifications.show({
        title: "Menu created",
        message:
          "Weekly menu has been created. Now assign templates to each day.",
        color: "green",
      })
    },
    onError: (error: unknown) => {
      let message = "Failed to create menu."
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as { response?: { data?: { week_start_date?: string[]; detail?: string } } }
        if (axiosError.response?.data?.week_start_date) {
          message = axiosError.response.data.week_start_date[0]
        } else if (axiosError.response?.data?.detail) {
          message = axiosError.response.data.detail
        }
      }
      notifications.show({
        title: "Error",
        message,
        color: "red",
      })
    },
  })

  const updateDailyMenuMutation = useMutation({
    mutationFn: ({
      id,
      templateId,
    }: {
      id: number
      templateId: number | null
    }) => foodApi.updateDailyMenu(id, { template_id: templateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["food", "menus"] })
      queryClient.invalidateQueries({ queryKey: ["food", "menu", "current"] })
    },
    onError: () => {
      notifications.show({
        title: "Error",
        message: "Failed to update menu.",
        color: "red",
      })
    },
  })

  const isLoading = menusLoading || templatesLoading

  // Find the menu for the selected week
  const currentWeekMenu = menus?.find((m) => m.week_start_date === weekStartStr)

  const templateOptions =
    templates?.map((t) => ({
      value: String(t.id),
      label: t.name,
    })) ?? []

  const handleCreateMenu = () => {
    createMenuMutation.mutate(weekStartStr)
  }

  const handleTemplateChange = (
    dailyMenuId: number,
    templateId: string | null,
  ) => {
    updateDailyMenuMutation.mutate({
      id: dailyMenuId,
      templateId: templateId ? Number(templateId) : null,
    })
  }

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={1}>Menu Management</Title>
          <Text c="dimmed">Create and manage weekly menus</Text>
        </div>
      </Group>

      {/* Week Navigation */}
      <Paper withBorder p="md" radius="md" mb="md">
        <Group justify="space-between">
          <ActionIcon
            variant="light"
            size="lg"
            onClick={() => setWeekOffset(weekOffset - 1)}
          >
            <IconChevronLeft size={20} />
          </ActionIcon>

          <Stack gap={0} align="center">
            <Text fw={500} size="lg">
              Week of {selectedWeekStart.format("MMMM D, YYYY")}
            </Text>
            <Text size="sm" c="dimmed">
              {selectedWeekStart.format("MMM D")} -{" "}
              {selectedWeekStart.add(3, "day").format("MMM D")}
            </Text>
            {weekOffset === 0 && (
              <Badge color="blue" variant="light" size="sm">
                Current Week
              </Badge>
            )}
            {weekOffset === 1 && (
              <Badge color="green" variant="light" size="sm">
                Next Week
              </Badge>
            )}
          </Stack>

          <ActionIcon
            variant="light"
            size="lg"
            onClick={() => setWeekOffset(weekOffset + 1)}
          >
            <IconChevronRight size={20} />
          </ActionIcon>
        </Group>
      </Paper>

      {isLoading ? (
        <Center h={200}>
          <Loader size="lg" />
        </Center>
      ) : !currentWeekMenu ? (
        <Alert icon={<IconAlertCircle size={16} />} color="yellow" mb="md">
          <Group justify="space-between" align="center">
            <Text>No menu exists for this week yet.</Text>
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={handleCreateMenu}
              loading={createMenuMutation.isPending}
            >
              Create Menu
            </Button>
          </Group>
        </Alert>
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Assign a menu template to each day. The template's description will
            be used automatically.
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {currentWeekMenu.daily_menus.map((day) => (
              <DailyMenuCard
                key={day.id}
                dailyMenu={day}
                templates={templates ?? []}
                templateOptions={templateOptions}
                onTemplateChange={handleTemplateChange}
                isUpdating={updateDailyMenuMutation.isPending}
              />
            ))}
          </SimpleGrid>
        </Stack>
      )}

      <Divider my="xl" />

      {/* Quick view of upcoming weeks */}
      <Title order={3} mb="md">
        Upcoming Weeks
      </Title>
      <Stack gap="sm">
        {[1, 2, 3, 4].map((offset) => {
          const weekStart = today
            .startOf("isoWeek")
            .add(offset, "week")
          const weekStartStrLocal = weekStart.format("YYYY-MM-DD")
          const hasMenu = menus?.some(
            (m) => m.week_start_date === weekStartStrLocal,
          )

          return (
            <Paper
              key={offset}
              withBorder
              p="sm"
              radius="md"
              style={{ cursor: "pointer" }}
              onClick={() => setWeekOffset(offset)}
            >
              <Group justify="space-between">
                <div>
                  <Text fw={500}>Week of {weekStart.format("MMMM D")}</Text>
                  <Text size="sm" c="dimmed">
                    {weekStart.format("MMM D")} -{" "}
                    {weekStart.add(3, "day").format("MMM D")}
                  </Text>
                </div>
                <Badge color={hasMenu ? "green" : "gray"} variant="light">
                  {hasMenu ? "Menu Set" : "No Menu"}
                </Badge>
              </Group>
            </Paper>
          )
        })}
      </Stack>
    </>
  )
}

interface SelectOption {
  value: string
  label: string
}

interface DailyMenuCardProps {
  dailyMenu: DailyMenu
  templates: MenuTemplate[]
  templateOptions: SelectOption[]
  onTemplateChange: (dailyMenuId: number, templateId: string | null) => void
  isUpdating: boolean
}

function DailyMenuCard({
  dailyMenu,
  templates,
  templateOptions,
  onTemplateChange,
  isUpdating,
}: DailyMenuCardProps) {
  const selectedTemplate = templates.find(
    (t) => t.id === dailyMenu.template?.id,
  )

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Text fw={500}>{dailyMenu.day_name}</Text>
          <Text size="xs" c="dimmed">
            {dayjs(dailyMenu.date).format("MMM D, YYYY")}
          </Text>
        </div>
        {dailyMenu.has_meat_option && (
          <Badge color="orange" variant="light" size="sm">
            Meat/Veg Day
          </Badge>
        )}
      </Group>

      <Select
        label="Menu Template"
        placeholder="Select a menu..."
        data={templateOptions}
        value={dailyMenu.template?.id ? String(dailyMenu.template.id) : null}
        onChange={(value) => onTemplateChange(dailyMenu.id, value)}
        clearable
        searchable
        disabled={isUpdating}
      />

      {selectedTemplate && (
        <Stack gap="xs" mt="sm">
          <Text size="sm" c="dimmed">
            {selectedTemplate.description}
          </Text>
          {selectedTemplate.has_meat_option && (
            <>
              <Text size="xs">
                <Text span fw={500} c="red">
                  Meat:
                </Text>{" "}
                {selectedTemplate.meat_description}
              </Text>
              <Text size="xs">
                <Text span fw={500} c="green">
                  Veg:
                </Text>{" "}
                {selectedTemplate.vegetarian_description}
              </Text>
            </>
          )}
        </Stack>
      )}
    </Paper>
  )
}
