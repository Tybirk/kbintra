import { describe, it, expect, vi, beforeEach } from "vitest"

import { housesApi } from "./houses"

import { apiClient } from "./client"

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),

    patch: vi.fn(),

    put: vi.fn(),

    delete: vi.fn(),
  },
}))

describe("housesApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getHouses calls GET /houses/", async () => {
    const mockHouses = [{ id: 1, name: "Hus 1" }]

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockHouses })

    const result = await housesApi.getHouses()

    expect(apiClient.get).toHaveBeenCalledWith("/houses/")

    expect(result).toEqual(mockHouses)
  })

  it("getHouse calls GET /houses/{id}/", async () => {
    const mockHouse = { id: 2, name: "Hus 2" }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockHouse })

    const result = await housesApi.getHouse(2)

    expect(apiClient.get).toHaveBeenCalledWith("/houses/2/")

    expect(result).toEqual(mockHouse)
  })

  it("getMyHouse calls GET /houses/my/", async () => {
    const mockHouse = { id: 1, name: "Mit hus" }

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockHouse })

    const result = await housesApi.getMyHouse()

    expect(apiClient.get).toHaveBeenCalledWith("/houses/my/")

    expect(result).toEqual(mockHouse)
  })

  it("updateMyHouse patches /houses/my/ with data", async () => {
    const mockHouse = { id: 1, description: "Opdateret beskrivelse" }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockHouse })

    const result = await housesApi.updateMyHouse({
      description: "Opdateret beskrivelse",
    })

    expect(apiClient.patch).toHaveBeenCalledWith("/houses/my/", {
      description: "Opdateret beskrivelse",
    })

    expect(result).toEqual(mockHouse)
  })

  it("updateMyHousePicture patches /houses/my/ with FormData", async () => {
    const mockHouse = { id: 1 }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockHouse })

    const file = new File(["img"], "hus.jpg", { type: "image/jpeg" })

    await housesApi.updateMyHousePicture(file)

    expect(apiClient.patch).toHaveBeenCalledWith(
      "/houses/my/",

      expect.any(FormData),
    )
  })

  it("getChildren calls GET /houses/my/children/", async () => {
    const mockChildren = [{ id: 1, name: "Emma" }]

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockChildren })

    const result = await housesApi.getChildren()

    expect(apiClient.get).toHaveBeenCalledWith("/houses/my/children/")

    expect(result).toEqual(mockChildren)
  })

  it("createChild posts to /houses/my/children/", async () => {
    const mockChild = { id: 1, name: "Oliver" }

    vi.mocked(apiClient.post).mockResolvedValue({ data: mockChild })

    const result = await housesApi.createChild({ name: "Oliver" })

    expect(apiClient.post).toHaveBeenCalledWith("/houses/my/children/", {
      name: "Oliver",
    })

    expect(result).toEqual(mockChild)
  })

  it("updateChild patches /houses/my/children/{id}/", async () => {
    const mockChild = { id: 1, name: "Oliver Updated" }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockChild })

    const result = await housesApi.updateChild(1, { name: "Oliver Updated" })

    expect(apiClient.patch).toHaveBeenCalledWith("/houses/my/children/1/", {
      name: "Oliver Updated",
    })

    expect(result).toEqual(mockChild)
  })

  it("deleteChild calls DELETE /houses/my/children/{id}/", async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({})

    await housesApi.deleteChild(1)

    expect(apiClient.delete).toHaveBeenCalledWith("/houses/my/children/1/")
  })

  it("getCars calls GET /houses/my/cars/", async () => {
    const mockCars = [{ id: 1, license_plate: "AB 12 345" }]

    vi.mocked(apiClient.get).mockResolvedValue({ data: mockCars })

    const result = await housesApi.getCars()

    expect(apiClient.get).toHaveBeenCalledWith("/houses/my/cars/")

    expect(result).toEqual(mockCars)
  })

  it("createCar posts to /houses/my/cars/", async () => {
    const mockCar = { id: 1, license_plate: "XY 99 999" }

    vi.mocked(apiClient.post).mockResolvedValue({ data: mockCar })

    const result = await housesApi.createCar({ license_plate: "XY 99 999" })

    expect(apiClient.post).toHaveBeenCalledWith("/houses/my/cars/", {
      license_plate: "XY 99 999",
    })

    expect(result).toEqual(mockCar)
  })

  it("updateCar patches /houses/my/cars/{id}/", async () => {
    const mockCar = { id: 1, is_electric: true }

    vi.mocked(apiClient.patch).mockResolvedValue({ data: mockCar })

    const result = await housesApi.updateCar(1, { is_electric: true })

    expect(apiClient.patch).toHaveBeenCalledWith("/houses/my/cars/1/", {
      is_electric: true,
    })

    expect(result).toEqual(mockCar)
  })

  it("deleteCar calls DELETE /houses/my/cars/{id}/", async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({})

    await housesApi.deleteCar(1)

    expect(apiClient.delete).toHaveBeenCalledWith("/houses/my/cars/1/")
  })
})
