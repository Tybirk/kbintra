/**
 * Bildeling (car sharing) API functions
 */

import { apiClient } from "./client"
import { asArray } from "./helpers"

import type {
  CarBlock,
  CarLoan,
  CarSharingTerms,
  SharedCarsResponse,
} from "../types"

import type { BlockInput } from "../utils/weekSchedule"

export interface SharedCarQuery {
  start: string
  end: string
  isofix?: boolean
  tow?: boolean
  seats?: number | null
}

export interface CarBlockFormData {
  days_of_week: number[]
  start_time: string
  end_time: string
}

export interface CarLoanRequestData {
  start_at: string
  end_at: string
  expected_km: number
  car_ids: number[]
  needs_isofix: boolean
  needs_tow_hitch: boolean
  min_seats: number | null
  note: string
  accepted_terms: boolean
}

export interface CompleteLoanData {
  actual_km: number
  expense_amount: string
  expense_note: string
  damage_note: string
}

export const carSharingApi = {
  // The delebilpark with availability for a given window
  getSharedCars: async (query: SharedCarQuery): Promise<SharedCarsResponse> => {
    const params = new URLSearchParams({ start: query.start, end: query.end })
    if (query.isofix) params.set("isofix", "true")
    if (query.tow) params.set("tow", "true")
    if (query.seats) params.set("seats", String(query.seats))
    const response = await apiClient.get(
      `/carsharing/cars/?${params.toString()}`,
    )
    return response.data
  },

  getTerms: async (): Promise<CarSharingTerms> => {
    const response = await apiClient.get("/carsharing/terms/")
    return response.data
  },

  // Weekly schedule for one of your own household's cars
  getBlocks: async (carId: number): Promise<CarBlock[]> => {
    const response = await apiClient.get(`/carsharing/cars/${carId}/blocks/`)
    return asArray(response.data)
  },

  createBlock: async (
    carId: number,
    data: CarBlockFormData,
  ): Promise<CarBlock> => {
    const response = await apiClient.post(
      `/carsharing/cars/${carId}/blocks/`,
      data,
    )
    return response.data
  },

  deleteBlock: async (blockId: number): Promise<void> => {
    await apiClient.delete(`/carsharing/blocks/${blockId}/`)
  },

  // Replace the whole schedule at once — what the painting grid produces.
  replaceBlocks: async (
    carId: number,
    blocks: BlockInput[],
  ): Promise<CarBlock[]> => {
    const response = await apiClient.put(`/carsharing/cars/${carId}/blocks/`, {
      blocks,
    })
    return asArray(response.data)
  },

  // Loans: your own, plus requests aimed at your household's cars
  getLoans: async (): Promise<CarLoan[]> => {
    const response = await apiClient.get("/carsharing/loans/")
    return asArray(response.data)
  },

  getLoan: async (loanId: number): Promise<CarLoan> => {
    const response = await apiClient.get(`/carsharing/loans/${loanId}/`)
    return response.data
  },

  requestLoan: async (data: CarLoanRequestData): Promise<CarLoan> => {
    const response = await apiClient.post("/carsharing/loans/", data)
    return response.data
  },

  // Owner answers a request about their car
  respondToCandidate: async (
    loanId: number,

    candidateId: number,

    action: "accept" | "decline",
  ): Promise<CarLoan> => {
    const response = await apiClient.post(
      `/carsharing/loans/${loanId}/candidates/${candidateId}/respond/`,

      { action },
    )
    return response.data
  },

  completeLoan: async (
    loanId: number,
    data: CompleteLoanData,
  ): Promise<CarLoan> => {
    const response = await apiClient.post(
      `/carsharing/loans/${loanId}/complete/`,
      data,
    )
    return response.data
  },

  cancelLoan: async (loanId: number): Promise<CarLoan> => {
    const response = await apiClient.post(`/carsharing/loans/${loanId}/cancel/`)
    return response.data
  },
}

/**
 * km * rate − expenses, mirroring CarLoan.calculate_amount_due on the server.
 * May be negative, in which case the owner owes the borrower.
 */
export function calculateAmountDue(
  km: number,
  ratePerKm: string,
  expenseAmount: string,
): number {
  const rate = Number.parseFloat(ratePerKm) || 0
  const expenses = Number.parseFloat(expenseAmount) || 0
  return Math.round((km * rate - expenses) * 100) / 100
}
