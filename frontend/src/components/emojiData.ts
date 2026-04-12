export interface EmojiItem {
  id: string

  name: string

  native: string
}

interface EmojiMartData {
  emojis: Record<string, {
    id: string

    name: string

    skins: Array<{ native: string }>
  }>
}

// Loaded lazily on first use so the 423KB JSON isn't bundled eagerly.

let loadPromise: Promise<EmojiItem[]> | null = null

function loadAllEmojis(): Promise<EmojiItem[]> {
  if (!loadPromise) {
    loadPromise = import("@emoji-mart/data").then((mod) => {
      const data = (mod.default ?? mod) as EmojiMartData

      return Object.values(data.emojis).map((e) => ({
        id: e.id,

        name: e.name,

        native: e.skins[0].native,
      }))
    })
  }

  return loadPromise
}

/**
 * Filter emojis by query (async — data is loaded on first call).
 * 1-char queries return only exact id matches (e.g. "v" → ✌️).
 * 2+ char queries do fuzzy matching on id and name.
 */

export async function filterEmojis(query: string): Promise<EmojiItem[]> {
  if (query.length === 0) return []

  const allEmojis = await loadAllEmojis()

  const q = query.toLowerCase()

  if (query.length === 1) {
    return allEmojis.filter((e) => e.id === q)
  }

  return allEmojis

    .filter((e) => e.id.includes(q) || e.name.toLowerCase().includes(q))

    .slice(0, 8)
}

/** Kick off the data load in the background (call on editor mount). */

export function prefetchEmojis(): void {
  loadAllEmojis().catch(() => {})
}
