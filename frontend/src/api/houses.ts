/**
 * Houses API functions
 */

import { apiClient } from "./client"
import { asArray } from "./helpers"

import type { Car, Child, House } from "../types"

export interface UpdateHouseData {
  description?: string
}

export interface CreateChildData {
  name: string

  birthdate?: string | null
}

export interface UpdateChildData {
  name?: string

  birthdate?: string | null
}

export interface CreateCarData {
  license_plate: string

  is_electric?: boolean
}

export interface UpdateCarData {
  license_plate?: string

  is_electric?: boolean
}

export const housesApi = {
  async getHouses(): Promise<House[]> {
    const response = await apiClient.get("/houses/")

    return asArray(response.data)
  },

  async getHouse(slug: string): Promise<House> {
    const response = await apiClient.get<House>(`/houses/${slug}/`)

    return response.data
  },

  async getMyHouse(): Promise<House> {
    const response = await apiClient.get<House>("/houses/my/")

    return response.data
  },

  async updateMyHouse(data: UpdateHouseData): Promise<House> {
    const response = await apiClient.patch<House>("/houses/my/", data)

    return response.data
  },

  async updateMyHousePicture(file: File): Promise<House> {
    const formData = new FormData()

    formData.append("profile_picture", file)

    const response = await apiClient.patch<House>("/houses/my/", formData)

    return response.data
  },

  async getChildren(): Promise<Child[]> {
    const response = await apiClient.get("/houses/my/children/")

    return asArray(response.data)
  },

  async createChild(data: CreateChildData): Promise<Child> {
    const response = await apiClient.post<Child>("/houses/my/children/", data)

    return response.data
  },

  async updateChild(id: number, data: UpdateChildData): Promise<Child> {
    const response = await apiClient.patch<Child>(
      `/houses/my/children/${id}/`,

      data,
    )

    return response.data
  },

  async deleteChild(id: number): Promise<void> {
    await apiClient.delete(`/houses/my/children/${id}/`)
  },

  async getCars(): Promise<Car[]> {
    const response = await apiClient.get("/houses/my/cars/")

    return asArray(response.data)
  },

  async createCar(data: CreateCarData): Promise<Car> {
    const response = await apiClient.post<Car>("/houses/my/cars/", data)

    return response.data
  },

  async updateCar(id: number, data: UpdateCarData): Promise<Car> {
    const response = await apiClient.patch<Car>(`/houses/my/cars/${id}/`, data)

    return response.data
  },

  async deleteCar(id: number): Promise<void> {
    await apiClient.delete(`/houses/my/cars/${id}/`)
  },
}
