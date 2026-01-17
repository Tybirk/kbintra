/**
 * Global search API module.
 */

import { apiClient } from "./client"

export type SearchResultType = "user" | "thread" | "post" | "subgroup" | "announcement" | "event" | "house" | "file"

export interface SearchItem {
  id: number
  type: SearchResultType
  title: string
  subtitle: string
  url: string
  score: number
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
  files: SearchItem[]
}

export interface SearchResponse {
  query: string
  results: SearchResults
  total_count: number
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
}
