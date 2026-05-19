/**
 * Global search API module.
 */

import { apiClient } from "./client"

export type SearchResultType = "user" | "thread" | "post" | "subgroup" | "announcement" | "event" | "house" | "car" | "file" | "folder"

export interface SearchItem {
  id: number

  type: SearchResultType

  title: string

  subtitle: string

  url: string

  score: number

  created_at?: string

  extra?: Record<string, unknown>
}

export interface SearchResults {
  users: SearchItem[]

  threads: SearchItem[]

  posts: SearchItem[]

  subgroups: SearchItem[]

  announcements: SearchItem[]

  events: SearchItem[]

  houses: SearchItem[]

  cars: SearchItem[]

  files: SearchItem[]
}

export interface SearchResponse {
  query: string

  results: SearchResults

  total_count: number

  group_order: string[]
}

export type SearchFuzziness = "exact" | "prefix" | "fuzzy"

export type SearchSort = "relevance" | "newest"

export interface AdvancedSearchParams {
  query: string
  types?: SearchResultType[]
  fuzziness?: SearchFuzziness
  sort?: SearchSort
  limit?: number
}

export interface AdvancedSearchResponse {
  query: string
  fuzziness: SearchFuzziness
  sort: SearchSort
  types: string[]
  results: Partial<Record<keyof SearchResults, SearchItem[]>>
  total_count: number
  group_order: string[]
}

export const searchApi = {
  /**
   * Perform a global search across all content.
   */

  search: async (query: string, limit: number = 5): Promise<SearchResponse> => {
    const response = await apiClient.get<SearchResponse>("/search/", {
      params: { q: query, limit },
    })

    return response.data
  },

  /**
   * Advanced search with type/fuzziness/sort controls. Backed by
   * GET /api/search/advanced/.
   */
  advanced: async (
    params: AdvancedSearchParams,
  ): Promise<AdvancedSearchResponse> => {
    const query: Record<string, string | number> = { q: params.query }
    if (params.types && params.types.length > 0) {
      query.types = params.types.join(",")
    }
    if (params.fuzziness) query.fuzziness = params.fuzziness
    if (params.sort) query.sort = params.sort
    if (params.limit) query.limit = params.limit

    const response = await apiClient.get<AdvancedSearchResponse>(
      "/search/advanced/",
      { params: query },
    )
    return response.data
  },
}
