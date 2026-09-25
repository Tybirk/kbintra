import {
  SegmentedControl,
  Select,
  Title,
  Typography,
  createTheme,
} from "@mantine/core"

import { DateInput, DatePickerInput } from "@mantine/dates"

/**
 * The app's Mantine theme.
 *
 * Its own module rather than a const in main.tsx so tests can render against
 * the same theme the app uses — several of the component defaults below exist
 * because of a bug report, and a default nobody can test is one that quietly
 * stops applying.
 */
export const theme = createTheme({
  primaryColor: "blue",

  // Automatically flip button/badge text to black or white based on background luminance

  autoContrast: true,

  fontFamily: "Inter, system-ui, sans-serif",

  fontSizes: {
    xs: "0.8125rem", // 13px (was 12px)
    sm: "0.9375rem", // 15px (was 14px)
    md: "1.0625rem", // 17px (was 16px)
    lg: "1.1875rem", // 19px (was 18px)
    xl: "1.3125rem", // 21px (was 20px)
  },

  headings: {
    fontFamily: "Inter, system-ui, sans-serif",
  },

  // Higher contrast dark palette:

  //   dark[0] → text color in dark mode (brighter, toward white)

  //   dark[7] → page body background (deeper, toward black)

  colors: {
    dark: [
      "#E8EAED", // [0] primary text — near-white (default ~#C9C9C9)

      "#C9CDD6", // [1]

      "#A0A5B0", // [2] dimmed text

      "#696E7B", // [3]

      "#4A4F5C", // [4] borders

      "#383C48", // [5] inner item card hover backgrounds

      "#232630", // [6] section card backgrounds (Paper) — elevated above body

      "#0C0D12", // [7] body background — near black (default ~#242424)

      "#08090D", // [8]

      "#050507", // [9] darkest
    ],
  },

  components: {
    Typography: Typography.extend({
      styles: {
        root: { overflowWrap: "break-word" },
      },
    }),

    Title: Title.extend({
      styles: {
        root: { overflowWrap: "break-word" },
      },
    }),

    DateInput: DateInput.extend({
      defaultProps: { valueFormat: "D. MMMM YYYY" },
    }),

    DatePickerInput: DatePickerInput.extend({
      defaultProps: { valueFormat: "D. MMMM YYYY" },
    }),

    SegmentedControl: SegmentedControl.extend({
      defaultProps: { color: "blue" },
    }),

    Select: Select.extend({
      // Mantine caps a dropdown at 220px. In accessibility mode the base font
      // is 20px, so that is five options — the sagsfilter's "Afsluttet" sat
      // below the fold, and the scrollbar only appears once you are already
      // scrolling, so it read as missing. A share of the viewport instead of a
      // pixel count keeps the list and the text scaling together.
      defaultProps: { maxDropdownHeight: "60vh" },
    }),
  },
})
