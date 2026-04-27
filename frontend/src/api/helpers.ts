// Coerce a response body into an array. Backend list endpoints may return
// either a plain array or a paginated `{results: [...]}` object. If a deploy
// or routing fallback returns something else (e.g. HTML served by the SPA
// container while the backend container is unregistered in Traefik), return []
// rather than letting a string reach a `.map`/`.forEach` call site.
// Returns `any[]` so callers don't have to repeat the element type — the
// enclosing function's return type still constrains the value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asArray = (data: unknown): any[] => {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    const results = (data as { results?: unknown }).results
    if (Array.isArray(results)) return results
  }
  return []
}
