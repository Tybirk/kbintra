import { useEffect, useState } from "react"

import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core"

import { notifications } from "@mantine/notifications"

import {
  IconAlertTriangle,
  IconChevronDown,
  IconInfoCircle,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { carSharingApi } from "../../api/carsharing"

import { housesApi } from "../../api/houses"

import { WeekHourGrid } from "../../components/WeekHourGrid"

import { formatLicensePlate } from "../../utils/licensePlate"

import {
  normalizeDecimalSeparator,
  toDanishDecimal,
} from "../../utils/decimalInput"

import {
  blocksToGrid,
  describeGrid,
  emptyGrid,
  gridToBlocks,
} from "../../utils/weekSchedule"

import {
  errorMessage,
  formatKr,
  moneyInputError,
  TermsConsent,
  useCarSharingMutation,
  useCarSharingTerms,
} from "./shared"

import type { HourGrid } from "../../utils/weekSchedule"

import type { Car, CarBlock } from "../../types"

// --- Tab 3: my cars ----------------------------------------------------------

interface MyCarCardProps {
  car: Car
}

function MyCarCard({ car }: MyCarCardProps) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [draft, setDraft] = useState(car)
  const [grid, setGrid] = useState<HourGrid>(emptyGrid)
  // What the server currently holds, so "Gem ugeskema" can tell whether the
  // painted week actually differs from it.
  const [savedGrid, setSavedGrid] = useState<HourGrid>(emptyGrid)

  useEffect(() => {
    setDraft(car)
  }, [car])

  const { data: blocks } = useQuery({
    queryKey: ["carsharing", "blocks", car.id],
    queryFn: () => carSharingApi.getBlocks(car.id),
    // One request per car on opening the tab is wasted work when every card
    // starts collapsed; fetch the first time the household opens one.
    enabled: expanded,
  })

  const { data: terms } = useCarSharingTerms()

  useEffect(() => {
    if (!blocks) return
    const loaded = blocksToGrid(blocks)
    setGrid(loaded)
    setSavedGrid(loaded)
  }, [blocks])

  const scheduleDirty = JSON.stringify(grid) !== JSON.stringify(savedGrid)

  // Sharing needs consent to the terms in force, so the save is blocked rather
  // than letting the server reject it after the fact.
  const termsBlockSave =
    draft.is_shared && !car.has_accepted_current_terms && !acceptTerms
  // A negative or unparseable rate reached borrowers as "-3,50 kr./km" and
  // inverted the bill, so catch it here as well as on the server.
  const rateError = moneyInputError(draft.rate_per_km ?? "", "en takst")

  const saveMutation = useCarSharingMutation({
    mutationFn: () =>
      housesApi.updateCar(car.id, {
        is_shared: draft.is_shared,
        rate_per_km: draft.rate_per_km
          ? normalizeDecimalSeparator(draft.rate_per_km)
          : null,
        make: draft.make,
        model_name: draft.model_name,
        color: draft.color,
        year: draft.year,
        seats: draft.seats,
        has_tow_hitch: draft.has_tow_hitch,
        has_isofix: draft.has_isofix,
        dogs_allowed: draft.dogs_allowed,
        has_charge_fob: draft.has_charge_fob,
        equipment_note: draft.equipment_note,
        practical_note: draft.practical_note,
        accept_terms: acceptTerms,
      }),
    successTitle: "Bilen er gemt",
    errorTitle: "Kunne ikke gemme bilen",
    onDone: () => {
      queryClient.invalidateQueries({ queryKey: ["cars"] })
    },
  })

  const deleteMutation = useCarSharingMutation({
    mutationFn: () => housesApi.deleteCar(car.id),
    successTitle: "Bilen er fjernet",
    errorTitle: "Kunne ikke fjerne bilen",
    errorFallback: "Bilen kan ikke fjernes, hvis den har lån tilknyttet.",
    onDone: () => {
      queryClient.invalidateQueries({ queryKey: ["cars"] })
    },
  })

  const saveScheduleMutation = useCarSharingMutation({
    mutationFn: () => carSharingApi.replaceBlocks(car.id, gridToBlocks(grid)),
    successTitle: "Ugeskemaet er gemt",
    successMessage: (saved: CarBlock[]) => describeGrid(blocksToGrid(saved)),
    errorTitle: "Kunne ikke gemme ugeskemaet",
    onDone: (saved: CarBlock[]) => {
      const loaded = blocksToGrid(saved)
      setGrid(loaded)
      setSavedGrid(loaded)
    },
  })

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <UnstyledButton
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={`Indstillinger for ${car.display_name}`}
        >
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap="xs" wrap="wrap">
              <Text fw={600}>{car.display_name}</Text>
              {car.license_plate &&
                car.display_name !== formatLicensePlate(car.license_plate) && (
                  <Badge variant="default" size="sm">
                    {formatLicensePlate(car.license_plate)}
                  </Badge>
                )}
              {/* The saved state, not the draft — the badge should say what the
                  rest of the community can see right now. */}
              <Badge
                color={car.is_shared ? "green" : "gray"}
                variant="light"
                size="sm"
              >
                {car.is_shared ? "I delebilparken" : "Ikke delt"}
              </Badge>
              {!car.license_plate && (
                <Badge color="yellow" variant="light" size="sm">
                  Mangler nummerplade
                </Badge>
              )}
              {car.is_shared && !car.has_accepted_current_terms && (
                <Badge color="yellow" variant="light" size="sm">
                  Vilkår mangler accept
                </Badge>
              )}
            </Group>
            <IconChevronDown
              size={18}
              style={{
                flexShrink: 0,
                transition: "transform 150ms ease",
                transform: expanded ? "rotate(180deg)" : undefined,
              }}
            />
          </Group>
        </UnstyledButton>

        {/* keepMounted={false} is not the default: without it the hidden fields
            stay in the DOM and tabbable, and every car keeps a 7×24 grid alive. */}
        <Collapse expanded={expanded} keepMounted={false}>
          <Stack gap="sm">
            <Switch
              label="Med i delebilparken"
              checked={draft.is_shared}
              onChange={(event) =>
                setDraft({ ...draft, is_shared: event.currentTarget.checked })
              }
            />
            {!car.license_plate && (
              <Alert
                color="yellow"
                variant="light"
                icon={<IconInfoCircle size={18} />}
              >
                Bilen skal have en nummerplade for at kunne være i
                delebilparken.
              </Alert>
            )}

            {car.is_shared && !car.has_accepted_current_terms && (
              <Alert
                color="yellow"
                variant="light"
                icon={<IconAlertTriangle size={18} />}
              >
                {car.terms_accepted_version
                  ? "Vilkårene er blevet opdateret. Bilen kan først lånes igen, når du accepterer de nye vilkår."
                  : "Bilen kan først lånes, når du har accepteret vilkårene for udlån."}
              </Alert>
            )}

            {terms && !car.has_accepted_current_terms && (
              <TermsConsent
                compact
                collapsible
                terms={terms}
                intro="Dette er de vilkår, låneren accepterer, når din bil lånes. Som ejer bekræfter du, at din bil udlånes på dem."
                label="Jeg har læst og accepterer vilkårene for at udlåne min bil"
                checked={acceptTerms}
                onChange={setAcceptTerms}
              />
            )}

            {car.has_accepted_current_terms && (
              <Text size="xs" c="dimmed">
                Vilkårene ({car.terms_accepted_version}) er accepteret for denne
                bil.
              </Text>
            )}

            <Group grow wrap="wrap">
              <TextInput
                label="Mærke"
                value={draft.make}
                onChange={(event) =>
                  setDraft({ ...draft, make: event.currentTarget.value })
                }
              />
              <TextInput
                label="Model"
                value={draft.model_name}
                onChange={(event) =>
                  setDraft({ ...draft, model_name: event.currentTarget.value })
                }
              />
            </Group>
            <Group grow wrap="wrap">
              <TextInput
                label="Farve"
                value={draft.color}
                onChange={(event) =>
                  setDraft({ ...draft, color: event.currentTarget.value })
                }
              />
              <NumberInput
                label="Årgang"
                value={draft.year ?? ""}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    year: typeof value === "number" ? value : null,
                  })
                }
                min={1950}
                max={2100}
              />
              <NumberInput
                label="Pladser"
                value={draft.seats ?? ""}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    seats: typeof value === "number" ? value : null,
                  })
                }
                min={1}
                max={9}
              />
            </Group>
            <TextInput
              label="Egen km-takst (kr., valgfrit)"
              error={rateError}
              description={
                terms
                  ? `Lad stå tom for at bruge fællesskabets standardtakst (${formatKr(
                      terms.default_rate_per_km,
                    )} pr. km).`
                  : "Lad stå tom for at bruge fællesskabets standardtakst."
              }
              value={toDanishDecimal(draft.rate_per_km)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  rate_per_km: event.currentTarget.value || null,
                })
              }
              inputMode="decimal"
              placeholder={
                terms ? toDanishDecimal(terms.default_rate_per_km) : "3,94"
              }
            />
            <Group gap="md" wrap="wrap">
              <Checkbox
                label="Træk"
                checked={draft.has_tow_hitch}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    has_tow_hitch: event.currentTarget.checked,
                  })
                }
              />
              <Checkbox
                label="Isofix"
                checked={draft.has_isofix}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    has_isofix: event.currentTarget.checked,
                  })
                }
              />
              <Checkbox
                label="Hunde tilladt"
                checked={draft.dogs_allowed}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    dogs_allowed: event.currentTarget.checked,
                  })
                }
              />
              <Checkbox
                label="Ladebrik i bilen"
                checked={draft.has_charge_fob}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    has_charge_fob: event.currentTarget.checked,
                  })
                }
              />
            </Group>
            <Textarea
              label="Andet udstyr"
              description="Fx. autostol, selepude, hundebur, tagbøjler, osv."
              value={draft.equipment_note}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  equipment_note: event.currentTarget.value,
                })
              }
              autosize
              minRows={2}
            />
            <Textarea
              label="Praktisk info til låneren"
              description="Hvor nøglen og ladebrikken er, og hvor bilen holder."
              value={draft.practical_note}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  practical_note: event.currentTarget.value,
                })
              }
              autosize
              minRows={2}
            />
            <Button
              loading={saveMutation.isPending}
              disabled={termsBlockSave || rateError !== null}
              onClick={() => saveMutation.mutate(undefined)}
            >
              Gem bil
            </Button>
            {termsBlockSave && (
              <Text size="xs" c="dimmed">
                Bekræft vilkårene for at have bilen i delebilparken.
              </Text>
            )}

            <Divider
              label="Ugeskema — hvornår er bilen normalt i brug?"
              labelPosition="left"
            />
            <Text size="xs" c="dimmed">
              Skemaet reserverer intet. Det viser blot andre, hvornår det
              sjældent passer.
            </Text>

            <WeekHourGrid value={grid} onChange={setGrid} />

            <Text size="xs" c="dimmed">
              {describeGrid(grid)}
            </Text>
            <Group gap="xs" wrap="wrap">
              <Button
                variant="light"
                loading={saveScheduleMutation.isPending}
                disabled={!scheduleDirty}
                onClick={() => saveScheduleMutation.mutate(undefined)}
              >
                Gem ugeskema
              </Button>
              {scheduleDirty && (
                <Button
                  variant="subtle"
                  onClick={() => setGrid(blocksToGrid(blocks ?? []))}
                >
                  Fortryd
                </Button>
              )}
            </Group>

            <Divider />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconTrash size={14} />}
                loading={deleteMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Fjern ${car.display_name} fra din husstand? Bilen forsvinder også fra delebilparken.`,
                    )
                  ) {
                    deleteMutation.mutate(undefined)
                  }
                }}
              >
                Fjern bil
              </Button>
            </Group>
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  )
}

function AddCarCard() {
  const queryClient = useQueryClient()
  const [plate, setPlate] = useState("")
  const [isElectric, setIsElectric] = useState(false)

  const createMutation = useMutation({
    mutationFn: () =>
      housesApi.createCar({
        license_plate: plate.trim(),
        is_electric: isElectric,
      }),
    onSuccess: (car) => {
      notifications.show({
        title: "Bilen er tilføjet",
        message: `${formatLicensePlate(car.license_plate)} — udfyld detaljerne nedenfor.`,
        color: "green",
      })
      setPlate("")
      setIsElectric(false)
      queryClient.invalidateQueries({ queryKey: ["cars"] })
    },
    onError: (error) => {
      notifications.show({
        title: "Kunne ikke tilføje bilen",
        message: errorMessage(error, "Tjek nummerpladen og prøv igen."),
        color: "red",
      })
    },
  })

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Text fw={600}>Tilføj en bil til din husstand</Text>
        <Group grow align="flex-end" wrap="wrap">
          <TextInput
            label="Nummerplade (valgfri)"
            description="Kræves først når bilen skal med i delebilparken."
            value={plate}
            onChange={(event) =>
              setPlate(event.currentTarget.value.toUpperCase())
            }
            placeholder="AB 12 345"
          />
          <Checkbox
            label="Elbil"
            checked={isElectric}
            onChange={(event) => setIsElectric(event.currentTarget.checked)}
          />
        </Group>
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          loading={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Tilføj bil
        </Button>
      </Stack>
    </Card>
  )
}

export function MyCarsTab() {
  const { data: cars, isLoading } = useQuery({
    queryKey: ["cars"],
    queryFn: housesApi.getCars,
  })

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  return (
    <Stack gap="md" mt="md">
      {(cars ?? []).length === 0 && (
        <Text size="sm" c="dimmed">
          Din husstand har ingen biler registreret endnu.
        </Text>
      )}
      {(cars ?? []).map((car) => (
        <MyCarCard key={car.id} car={car} />
      ))}
      <AddCarCard />
      <Text size="xs" c="dimmed">
        Nummerplade og elbil-markering kan også rettes under din husstands side
        i Beboere.
      </Text>
    </Stack>
  )
}
