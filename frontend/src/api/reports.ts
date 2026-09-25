/**
 * Indrapportering API functions
 */

import { apiClient, getAccessToken } from "./client"

import type {
  Report,
  ReportKind,
  ReportList,
  ReportStatus,
  ReportSubgroup,
} from "../types"

export interface ReportFormData {
  subgroup: string
  kind: ReportKind
  description: string
  location: string
}

export interface ReportFilters {
  subgroup?: string
  // "open" is a pseudo-status meaning "everything the udvalg still owes an answer on".
  status?: ReportStatus | "open"
  kind?: ReportKind
  q?: string
  mine?: boolean
  page?: number
}

/** A status change, a comment, or both — the udvalg's combined update form. */
export interface ReportEventPayload {
  status?: ReportStatus
  message?: string
}

function toQuery(filters: ReportFilters): string {
  const params = new URLSearchParams()
  if (filters.subgroup) params.set("subgroup", filters.subgroup)
  if (filters.status) params.set("status", filters.status)
  if (filters.kind) params.set("kind", filters.kind)
  if (filters.q) params.set("q", filters.q)
  if (filters.mine) params.set("mine", "true")
  if (filters.page && filters.page > 1) params.set("page", String(filters.page))
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export const reportsApi = {
  async list(filters: ReportFilters = {}): Promise<ReportList> {
    const response = await apiClient.get<ReportList>(
      `/reports/${toQuery(filters)}`,
    )
    return response.data
  },

  async get(subgroupSlug: string, number: number): Promise<Report> {
    const response = await apiClient.get<Report>(
      `/reports/${subgroupSlug}/${number}/`,
    )
    return response.data
  },

  async subgroups(): Promise<ReportSubgroup[]> {
    const response = await apiClient.get<ReportSubgroup[]>(
      "/reports/subgroups/",
    )
    return response.data
  },

  async create(data: ReportFormData, photos: File[]): Promise<Report> {
    const fd = new FormData()
    fd.append("subgroup", data.subgroup)
    fd.append("kind", data.kind)
    fd.append("description", data.description)
    fd.append("location", data.location)
    photos.forEach((photo) => fd.append("photos", photo))
    const response = await apiClient.post<Report>("/reports/", fd)
    return response.data
  },

  async update(
    subgroupSlug: string,
    number: number,
    data: Partial<Omit<ReportFormData, "subgroup">>,
  ): Promise<Report> {
    const response = await apiClient.patch<Report>(
      `/reports/${subgroupSlug}/${number}/`,
      data,
    )
    return response.data
  },

  async remove(subgroupSlug: string, number: number): Promise<void> {
    await apiClient.delete(`/reports/${subgroupSlug}/${number}/`)
  },

  /** Add a comment, change the status, or both in one go. */
  async addEvent(
    subgroupSlug: string,
    number: number,
    payload: ReportEventPayload,
  ): Promise<Report> {
    const response = await apiClient.post<Report>(
      `/reports/${subgroupSlug}/${number}/events/`,
      payload,
    )
    return response.data
  },

  async addPhotos(
    subgroupSlug: string,
    number: number,
    photos: File[],
  ): Promise<Report> {
    const fd = new FormData()
    photos.forEach((photo) => fd.append("photos", photo))
    const response = await apiClient.post<Report>(
      `/reports/${subgroupSlug}/${number}/photos/`,
      fd,
    )
    return response.data
  },

  async removePhoto(photoId: number): Promise<void> {
    await apiClient.delete(`/reports/photos/${photoId}/`)
  },

  // CSV export: token fetch -> blob download (mirrors the udlæg pattern).
  async exportCsv(subgroupSlug: string): Promise<void> {
    const token = getAccessToken()
    const response = await fetch(
      `/api/reports/export/?subgroup=${subgroupSlug}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    if (!response.ok) throw new Error("Eksport fejlede")
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `indrapporteringer_${subgroupSlug}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  },
}
