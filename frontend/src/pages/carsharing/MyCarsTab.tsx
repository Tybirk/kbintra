import { useEffect, useMemo, useState } from "react"

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

import { toDanishDecimal } from "../../utils/decimalInput"

import {
  blocksToGrid,
  describeGrid,
  emptyGrid,
  gridsEqual,
  gridToBlocks,
} from "../../utils/weekSchedule"

import { carDraftDirty, carPayload, unsavedChangesHint } from "./carDraft"

import {
  errorMessage,
  formatKr,
  LicensePlateBadge,
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

/**
 * Thrown when the car's fields saved but its week schedule did not.
 *
 * One button, two endpoints, so a press can land halfway. A household that is
 * only told "kunne ikke gemme" will retype the half that did save, so the toast
 * has to distinguish this case — that is all this type is for.
 */
class ScheduleSaveError extends Error {
  constructor() {
    super("Ugeskemaet blev ikke gemt.")
  }
}

function MyCarCard({ car }: MyCarCardProps) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [draft, setDraft] = useState(car)
  const [grid, setGrid] = useState<HourGrid>(emptyGrid)
  // Whether the household has painted since the week was loaded or last saved.
  // Needed because every refetch below carries a fresh blocks array: a
  // window-focus refetch, or the ["carsharing"] invalidation any neighbour's loan
  // event triggers, used to wipe a week that was still being painted.
  const [gridTouched, setGridTouched] = useState(false)

  useEffect(() => {
    // Take the server's version only when there is nothing unsaved to lose. The
    // cars query refetches on focus and after every save, and it used to reset
    // fields the household was still filling in.
    setDraft((current) => (carDraftDirty(current, car) ? current : car))
  }, [car])

  const { data: blocks } = useQuery({
    queryKey: ["carsharing", "blocks", car.id],
    queryFn: () => carSharingApi.getBlocks(car.id),
    // One request per car on opening the tab is wasted work when every card
    // starts collapsed; fetch the first time the household opens one.
    enabled: expanded,
  })

  const { data: terms } = useCarSharingTerms()

  // What the server holds, so the save can tell whether the painted week differs
  // from it. Derived rather than kept in state: one fewer copy to get out of step.
  const savedGrid = useMemo(() => blocksToGrid(blocks ?? []), [blocks])

  useEffect(() => {
    if (!blocks || gridTouched) return
    setGrid(savedGrid)
  }, [blocks, savedGrid, gridTouched])

  const scheduleDirty = gridTouched && !gridsEqual(grid, savedGrid)
  // The terms tick is consent rather than a field, so it counts as something to
  // save on its own: a car already in the delebilpark whose terms got a new
  // version has nothing else to change.
  const carDirty = carDraftDirty(draft, car) || acceptTerms
  const dirty = carDirty || scheduleDirty

  // Sharing needs consent to the terms in force, so the save is blocked rather
  // than letting the server reject it after the fact.
  const termsBlockSave =
    draft.is_shared && !car.has_accepted_current_terms && !acceptTerms
  // The plate is edited here, so the rule the server enforces has to hold against
  // the draft rather than the saved car: a shared car must be identifiable.
  const plateFilled = draft.license_plate.trim() !== ""
  const plateBlocksSave = draft.is_shared && !plateFilled
  // A negative or unparseable rate reached borrowers as "-3,50 kr./km" and
  // inverted the bill, so catch it here as well as on the server.
  const rateError = moneyInputError(draft.rate_per_km ?? "", "en takst")

  // Why the save is unavailable, in the words of the thing to fix. The button now
  // sits below the week grid, far from the field at fault, so a disabled button
  // with nothing beside it would be a dead end.
  const blockedReason = plateBlocksSave
    ? 'Udfyld nummerpladen, eller slå "Med i delebilparken" fra.'
    : termsBlockSave
      ? "Bekræft vilkårene for at have bilen i delebilparken."
      : rateError
        ? "Ret km-taksten, før du kan gemme."
        : null

  /**
   * One press saves the whole card: the fields, the week schedule, or both.
   *
   * The two used to have a button each, which left a household guessing whether
   * it had to press both. Only the halves that actually changed are sent, so a
   * painted week does not also re-PATCH fifteen unchanged fields.
   */
  const saveMutation = useCarSharingMutation({
    mutationFn: async () => {
      if (carDirty) {
        await housesApi.updateCar(car.id, {
          ...carPayload(draft),
          accept_terms: acceptTerms,
        })
        // Refresh the list here rather than in onDone: the schedule below may
        // still fail, and this half is stored either way. Leaving it until
        // afterwards let the card go on offering to save fields the server had
        // already taken, while the toast said they were saved.
        await queryClient.invalidateQueries({ queryKey: ["cars"] })
      }
      if (!scheduleDirty) return null
      try {
        return await carSharingApi.replaceBlocks(car.id, gridToBlocks(grid))
      } catch (error) {
        // The fields are already stored at this point. Reporting this as a plain
        // failure would read as "nothing was saved" and invite retyping them.
        if (carDirty) throw new ScheduleSaveError()
        throw error
      }
    },
    successTitle: "Ændringerne er gemt",
    successMessage: (saved: CarBlock[] | null) =>
      saved ? describeGrid(blocksToGrid(saved)) : "",
    errorTitle: (error: unknown) =>
      error instanceof ScheduleSaveError
        ? "Ugeskemaet blev ikke gemt"
        : "Kunne ikke gemme ændringerne",
    errorFallback: (error: unknown) =>
      error instanceof ScheduleSaveError
        ? "Bilens oplysninger er gemt. Ugeskemaet er ikke — prøv at gemme igen."
        : "Prøv igen.",
    onDone: (saved: CarBlock[] | null) => {
      setAcceptTerms(false)
      setGridTouched(false)
      // Show what the server actually stored — hour runs collapse into blocks —
      // without waiting for the refetch the wrapper has just triggered.
      if (saved) {
        queryClient.setQueryData(["carsharing", "blocks", car.id], saved)
      }
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

  function discardChanges() {
    setDraft(car)
    setAcceptTerms(false)
    setGrid(savedGrid)
    setGridTouched(false)
  }

  return (
    // overflow must stay visible: Mantine's Card sets overflow:hidden, which
    // makes it the scrollport for anything inside and silently stops the week
    // grid's sticky day header (Man…Søn) from pinning at all.
    <Card withBorder radius="md" padding="md" style={{ overflow: "visible" }}>
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
                  <LicensePlateBadge plate={car.license_plate} />
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
              {/* The one badge that is about the draft rather than the saved car.
                  The save sits below the week grid now, so a card folded away
                  mid-edit has to admit that something is still waiting. */}
              {dirty && (
                <Badge color="blue" variant="light" size="sm">
                  Ikke gemt
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
            {/* Only while sharing is actually intended — a household keeping a
                private car in the directory is not missing anything. The draft,
                not the saved car, so it clears as soon as the plate is typed. */}
            {draft.is_shared && !plateFilled && (
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

            {/* Consent to lending terms belongs to a car being lent out. It used
                to greet every car, pushing Mærke/Model below the fold. */}
            {draft.is_shared && terms && !car.has_accepted_current_terms && (
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

            {/* Full width, not sharing a <Group grow> with the Elbil checkbox:
                that gave a 7-character field half a 360px screen while its
                two-line label and description wrapped beside a lone tickbox.
                Elbil now sits with the other yes/no facts about the car. */}
            <TextInput
              label="Nummerplade"
              description="Kræves for at bilen kan være i delebilparken."
              value={draft.license_plate}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  license_plate: event.currentTarget.value.toUpperCase(),
                })
              }
              placeholder="AB 12 345"
            />
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
                label="Sæder"
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
                label="Elbil"
                checked={draft.is_electric}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    is_electric: event.currentTarget.checked,
                  })
                }
              />
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
              description="Fx. hvor nøglen og ladebrikken er."
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
            <Divider
              label="Ugeskema — hvornår er bilen normalt i brug?"
              labelPosition="left"
            />
            <Text size="xs" c="dimmed">
              Skemaet reserverer intet. Det viser blot andre, hvornår det
              sjældent passer.
            </Text>

            <WeekHourGrid
              value={grid}
              onChange={(next) => {
                setGrid(next)
                setGridTouched(true)
              }}
            />

            <Text size="xs" c="dimmed">
              {describeGrid(grid)}
            </Text>

            {/* One save for the whole card, at the bottom of it: the fields and
                the week used to have a button each, which left a household
                wondering whether it had to press both. */}
            <Group gap="xs" wrap="wrap">
              <Button
                loading={saveMutation.isPending}
                disabled={!dirty || blockedReason !== null}
                onClick={() => saveMutation.mutate(undefined)}
              >
                Gem ændringer
              </Button>
              {dirty && !saveMutation.isPending && (
                <Button variant="subtle" onClick={discardChanges}>
                  Fortryd
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {blockedReason ??
                unsavedChangesHint({ car: carDirty, schedule: scheduleDirty })}
            </Text>

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
        {/* Full width, like the edit form: halving a 360px screen left the label
            "Nummerplade (valgfri)" wrapping over two lines and its description
            over three, beside a column holding one 20px tickbox. */}
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
