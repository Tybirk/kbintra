import { lazy, Suspense } from "react"

import { Loader, useComputedColorScheme } from "@mantine/core"

const LazyPicker = lazy(() => import("@emoji-mart/react"))

// Handed over as a function, emoji-mart waits for it. Handed over as a value
// that was still loading when the picker opened, it fetched the whole set
// from a CDN instead.
const loadEmojiData = () => import("@emoji-mart/data").then((m) => m.default)

// emoji-mart ships no Danish: locale="da" fell back to English. The emoji
// names and search words stay English, since they are its data.
const DANISH = {
  search: "Søg",

  search_no_results_1: "Åh nej!",

  search_no_results_2: "Den emoji findes ikke",

  pick: "Vælg en emoji…",

  add_custom: "Tilføj egen emoji",

  categories: {
    activity: "Aktiviteter",

    custom: "Egne",

    flags: "Flag",

    foods: "Mad og drikke",

    frequent: "Ofte brugte",

    nature: "Dyr og natur",

    objects: "Ting",

    people: "Smileys og mennesker",

    places: "Rejser og steder",

    search: "Søgeresultater",

    symbols: "Symboler",
  },

  skins: {
    choose: "Vælg standardhudfarve",

    1: "Standard",

    2: "Lys",

    3: "Mellemlys",

    4: "Mellem",

    5: "Mellemmørk",

    6: "Mørk",
  },
}

export interface PickedEmoji {
  native: string
}

interface EmojiMartPickerProps {
  onEmojiSelect: (emoji: PickedEmoji) => void
}

/** emoji-mart's full picker, as every picker in the app shows it. */
export default function EmojiMartPicker({
  onEmojiSelect,
}: EmojiMartPickerProps) {
  const colorScheme = useComputedColorScheme("light")

  return (
    <Suspense fallback={<Loader size="sm" m="md" />}>
      <LazyPicker
        data={loadEmojiData}
        i18n={DANISH}
        theme={colorScheme}
        onEmojiSelect={onEmojiSelect}
        previewPosition="none"
        skinTonePosition="search"
        searchPosition="sticky"
        navPosition="top"
        perLine={9}
        emojiSize={22}
        emojiButtonSize={32}
        maxFrequentRows={2}
      />
    </Suspense>
  )
}
