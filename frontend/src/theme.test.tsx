import { describe, expect, it } from "vitest"

import { render, screen } from "@testing-library/react"

import userEvent from "@testing-library/user-event"

import { MantineProvider, Select } from "@mantine/core"

import { theme } from "./theme"

describe("theme", () => {
  // Reported as "Afsluttede mangler i sagsfilteret": Mantine's 220px cap fits
  // five options at the 20px base font of accessibility mode, so the last ones
  // sat below a fold whose scrollbar only appears once you scroll.
  it("scales a Select dropdown with the viewport instead of capping it at 220px", async () => {
    render(
      <MantineProvider theme={theme}>
        <Select
          aria-label="Filtrér efter status"
          data={["Ny", "I gang", "Afsluttet", "Afvist"]}
        />
      </MantineProvider>,
    )

    // [0] is the visible input; Mantine renders a hidden one beside it.
    const input = screen.getAllByLabelText("Filtrér efter status")[0]
    await userEvent.click(input)

    const options = document.getElementById(
      input.getAttribute("aria-controls")!,
    )
    const scroller = options?.querySelector<HTMLElement>(
      "[style*='max-height']",
    )
    expect(scroller?.style.maxHeight).toBe("60vh")
  })
})
