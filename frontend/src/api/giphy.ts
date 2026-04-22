interface GiphyRandomResponse {
  data: {
    id: string

    title: string

    images: {
      original: { url: string }

      downsized: { url: string }
    }
  }
}

export interface GiphyResult {
  id: string

  title: string

  originalUrl: string

  previewUrl: string
}

export async function fetchRandomGif(query: string): Promise<GiphyResult> {
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY

  if (!apiKey) throw new Error("VITE_GIPHY_API_KEY er ikke konfigureret")

  const params = new URLSearchParams({
    api_key: apiKey,

    tag: query,

    rating: "g",
  })

  const res = await fetch(`https://api.giphy.com/v1/gifs/random?${params}`)

  if (!res.ok) throw new Error(`Giphy API fejl: ${res.status}`)

  const json = (await res.json()) as GiphyRandomResponse

  if (!json.data?.id) throw new Error("Ingen GIF fundet")

  return {
    id: json.data.id,

    title: json.data.title,

    originalUrl: json.data.images.original.url,

    previewUrl: json.data.images.downsized.url,
  }
}
