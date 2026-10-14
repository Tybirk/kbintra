import {
  Drawer,
  Stack,
  Title,
  Text,
  Table,
  Button,
  Divider,
} from "@mantine/core"

import { IconPrinter } from "@tabler/icons-react"

import type { RecipeSheet, DayFrontPage } from "../types"

// Print just the `.recipe-print-area` via the browser's native print-to-PDF
// (every phone has it). Print CSS in index.css isolates that element.
function printArea() {
  const cleanup = () => {
    document.body.classList.remove("printing-recipe")
    window.removeEventListener("afterprint", cleanup)
  }
  window.addEventListener("afterprint", cleanup)
  document.body.classList.add("printing-recipe")
  window.print()
}

interface RecipeViewProps {
  recipe: RecipeSheet
}

// Renders a single dish: ingredient table (amount/unit/name/comment) + the
// Fremgangsmåde steps. Steps are shown as plain paragraphs because the source
// text already carries its own numbering (or sub-headers like "Bulgur"), so an
// ordered list would double-number them.
export function RecipeView({ recipe }: RecipeViewProps) {
  const hasContent = recipe.ingredients.length > 0 || recipe.steps.length > 0

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{recipe.name}</Title>
        {recipe.weekday && (
          <Text size="sm" c="dimmed">
            {recipe.weekday}
          </Text>
        )}
      </div>

      {recipe.ingredients.length > 0 && (
        <div>
          <Text fw={600} mb={6}>
            Ingredienser
          </Text>
          <Table withRowBorders={false} verticalSpacing={4} fz="sm">
            <Table.Tbody>
              {recipe.ingredients.map((ing, i) => (
                <Table.Tr key={`${i}-${ing.name}`}>
                  <Table.Td
                    style={{
                      whiteSpace: "nowrap",
                      textAlign: "right",
                      verticalAlign: "top",
                      width: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {ing.amount} {ing.unit}
                  </Table.Td>
                  <Table.Td>
                    {ing.name}
                    {ing.comment && (
                      <Text span size="xs">
                        {" "}
                        — {ing.comment}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      {recipe.steps.length > 0 && (
        <div>
          <Text fw={600} mb={6}>
            Fremgangsmåde
          </Text>
          <Stack gap={8}>
            {recipe.steps.map((step, i) => (
              <Text key={`${i}-${step.slice(0, 12)}`} size="sm">
                {step}
              </Text>
            ))}
          </Stack>
        </div>
      )}

      {!hasContent && (
        <Text size="sm" c="dimmed">
          Opskriften kunne ikke hentes. Åbn opskriftsmappen for detaljer.
        </Text>
      )}
    </Stack>
  )
}

interface RecipeDrawerProps {
  recipe: RecipeSheet | null
  opened: boolean
  onClose: () => void
}

// Bottom drawer (mobile-first) that displays a recipe in-app. The "Print /
// gem som PDF" button reuses the browser's native print-to-PDF — every phone
// has it — by isolating `.recipe-print-area` via print CSS in index.css.
export function RecipeDrawer({ recipe, opened, onClose }: RecipeDrawerProps) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="85%"
      title="Opskrift"
      padding="lg"
    >
      {recipe && (
        <Stack gap="md">
          <div className="recipe-print-area">
            <RecipeView recipe={recipe} />
          </div>
          <Divider />
          <Button
            variant="light"
            color="green"
            leftSection={<IconPrinter size={16} />}
            onClick={printArea}
          >
            Print / gem som PDF
          </Button>
        </Stack>
      )}
    </Drawer>
  )
}

interface FrontPageViewProps {
  frontPage: DayFrontPage
}

// Renders a single day's "forside": the dish title plus the document's body
// blocks (section headings rendered bold, paragraphs preserve line breaks).
export function FrontPageView({ frontPage }: FrontPageViewProps) {
  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>{frontPage.title || frontPage.weekday}</Title>
        {frontPage.weekday && (
          <Text size="sm" c="dimmed">
            {frontPage.weekday}
          </Text>
        )}
      </div>

      {frontPage.blocks.map((block, i) =>
        block.heading ? (
          <Text key={`${i}-${block.text.slice(0, 12)}`} fw={600} mt="xs">
            {block.text}
          </Text>
        ) : (
          <Text
            key={`${i}-${block.text.slice(0, 12)}`}
            size="sm"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {block.text}
          </Text>
        ),
      )}

      {frontPage.blocks.length === 0 && (
        <Text size="sm" c="dimmed">
          Ingen forside-tekst for denne dag.
        </Text>
      )}
    </Stack>
  )
}

interface FrontPageDrawerProps {
  frontPage: DayFrontPage | null
  opened: boolean
  onClose: () => void
}

export function FrontPageDrawer({
  frontPage,
  opened,
  onClose,
}: FrontPageDrawerProps) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="85%"
      title="Dagens forside"
      padding="lg"
    >
      {frontPage && (
        <Stack gap="md">
          <div className="recipe-print-area">
            <FrontPageView frontPage={frontPage} />
          </div>
          <Divider />
          <Button
            variant="light"
            color="green"
            leftSection={<IconPrinter size={16} />}
            onClick={printArea}
          >
            Print / gem som PDF
          </Button>
        </Stack>
      )}
    </Drawer>
  )
}
