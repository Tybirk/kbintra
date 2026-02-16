/**
 * Useful Links API functions
 */

import { apiClient } from "./client"

interface UsefulLinks {
  content: string
  updated_at: string
}

export const linksApi = {
  getLinks: async (): Promise<UsefulLinks> => {
    const response = await apiClient.get("/links/")
    return response.data
  },

  updateLinks: async (content: string): Promise<UsefulLinks> => {
    const response = await apiClient.put("/links/", { content })
    return response.data
  },
}
