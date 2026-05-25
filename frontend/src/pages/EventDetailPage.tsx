import { useEffect } from "react"

import { useParams, useNavigate, useLocation } from "react-router-dom"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { Loader, Center, Stack, Text, Button } from "@mantine/core"

import { eventsApi } from "../api/events"

import { notificationsApi } from "../api/notifications"

import EventHeader from "../components/EventHeader"

export default function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>()

  const navigate = useNavigate()

  const location = useLocation()

  const queryClient = useQueryClient()

  const {
    data: event,

    isLoading,

    error,
  } = useQuery({
    queryKey: ["event", slug],

    queryFn: () => eventsApi.getEvent(slug!),

    enabled: !!slug,
  })

  // Community events with a discussion thread are rendered inside ThreadPage
  // (event header + full forum thread view). Redirect there so deep links to
  // /kalender/<slug> from notifications and the calendar still work.

  useEffect(() => {
    if (event?.thread_id && event.thread_subgroup_slug && event.thread_slug) {
      navigate(
        `/forum/${event.thread_subgroup_slug}/traad/${event.thread_slug}${location.hash}`,
        { replace: true },
      )
    }
  }, [event?.thread_id, event?.thread_subgroup_slug, event?.thread_slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-mark event notifications as read when visiting the event page

  useEffect(() => {
    if (slug) {
      notificationsApi
        .markReadByLink(`/kalender/${slug}`)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["notifications"] })

          queryClient.invalidateQueries({
            queryKey: ["notifications", "unread-count"],
          })
        })
        .catch(() => {})
    }
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <Center h={300}>
        <Loader size="lg" />
      </Center>
    )
  }

  if (error || !event) {
    return (
      <Center h={300}>
        <Stack align="center" gap="md">
          <Text c="red">Kunne ikke indlæse begivenhed.</Text>
          <Button variant="light" onClick={() => navigate("/kalender")}>
            Tilbage til kalender
          </Button>
        </Stack>
      </Center>
    )
  }

  // While the redirect-to-thread effect is in flight, render nothing.
  if (event.thread_id) {
    return null
  }

  return <EventHeader slug={slug!} />
}
