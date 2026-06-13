/**
 * Expenses (Udlæg) API functions
 */

import { apiClient, getAccessToken } from "./client"

import type { AdminExpenseList, Expense, ExpenseStatus } from "../types"

export interface ExpenseFormData {
  reg_nr: string
  account_number: string
  amount: string
  description: string
  approval_reference: string
}

export interface AdminExpenseFilters {
  status?: ExpenseStatus
  user?: number
  from?: string
  to?: string
  ordering?: string
  page?: number
}

function buildFormData(data: ExpenseFormData, files: File[]): FormData {
  const fd = new FormData()
  fd.append("reg_nr", data.reg_nr)
  fd.append("account_number", data.account_number)
  fd.append("amount", data.amount)
  fd.append("description", data.description)
  fd.append("approval_reference", data.approval_reference)
  files.forEach((file) => fd.append("files", file))
  return fd
}

function toQuery(filters: AdminExpenseFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set("status", filters.status)
  if (filters.user) params.set("user", String(filters.user))
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  if (filters.ordering) params.set("ordering", filters.ordering)
  if (filters.page && filters.page > 1) params.set("page", String(filters.page))
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export const expensesApi = {
  async listMine(): Promise<Expense[]> {
    const response = await apiClient.get<Expense[]>("/expenses/")
    return response.data
  },

  async create(data: ExpenseFormData, files: File[]): Promise<Expense> {
    const response = await apiClient.post<Expense>(
      "/expenses/",
      buildFormData(data, files),
    )
    return response.data
  },

  async update(id: number, data: Partial<ExpenseFormData>): Promise<Expense> {
    const response = await apiClient.patch<Expense>(`/expenses/${id}/`, data)
    return response.data
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`/expenses/${id}/`)
  },

  async addAttachment(id: number, files: File[]): Promise<Expense> {
    const fd = new FormData()
    files.forEach((file) => fd.append("files", file))
    const response = await apiClient.post<Expense>(
      `/expenses/${id}/attachments/`,
      fd,
    )
    return response.data
  },

  async removeAttachment(attachmentId: number): Promise<void> {
    await apiClient.delete(`/expenses/attachments/${attachmentId}/`)
  },

  // Admin
  async listAll(filters: AdminExpenseFilters): Promise<AdminExpenseList> {
    const response = await apiClient.get<AdminExpenseList>(
      `/expenses/admin/${toQuery(filters)}`,
    )
    return response.data
  },

  async setStatus(
    id: number,
    status: ExpenseStatus,
    adminNote: string,
  ): Promise<Expense> {
    const response = await apiClient.patch<Expense>(`/expenses/${id}/status/`, {
      status,
      admin_note: adminNote,
    })
    return response.data
  },

  // CSV export: token fetch -> blob download (mirrors AdminPage's pattern).
  async exportCsv(filters: AdminExpenseFilters): Promise<void> {
    const token = getAccessToken()
    const response = await fetch(
      `/api/expenses/admin/export/${toQuery(filters)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    if (!response.ok) throw new Error("Eksport fejlede")
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `udlaeg_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  },
}
