import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render } from "../test/testUtils"
import DirectoryPage from "./DirectoryPage"

const mockNavigate = vi.fn()
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
  Notifications: () => null,
}))

const mockGetHouses = vi.fn()
vi.mock("../api/houses", () => ({
  housesApi: {
    getHouses: () => mockGetHouses(),
  },
}))

// Mock UserLink to avoid routing complexity
vi.mock("../components/UserLink", () => ({
  default: ({
    firstName,
    lastName,
  }: {
    firstName: string
    lastName: string
  }) => (
    <span>
      {firstName} {lastName}
    </span>
  ),
}))

const mockHouses = [
  {
    id: 1,
    name: "Hus A",
    description: "Første hus",
    profile_picture: null,
    inhabitants: [
      {
        id: 10,
        first_name: "Peter",
        last_name: "Hansen",
        profile_picture: null,
      },
    ],
    children: [],
  },
  {
    id: 2,
    name: "Hus B",
    description: null,
    profile_picture: null,
    inhabitants: [
      {
        id: 20,
        first_name: "Maria",
        last_name: "Nielsen",
        profile_picture: null,
      },
    ],
    children: [{ id: 1, name: "Emma" }],
  },
]

describe("DirectoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHouses.mockResolvedValue(mockHouses)
  })

  it("renders page title 'Beboeroversigt'", async () => {
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Beboeroversigt")).toBeInTheDocument()
    })
  })

  it("shows all houses in grid", async () => {
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Hus A")).toBeInTheDocument()
      expect(screen.getByText("Hus B")).toBeInTheDocument()
    })
  })

  it("shows resident names in house cards", async () => {
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Peter Hansen")).toBeInTheDocument()
      expect(screen.getByText("Maria Nielsen")).toBeInTheDocument()
    })
  })

  it("shows child name with Barn badge", async () => {
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Emma")).toBeInTheDocument()
      expect(screen.getByText("Barn")).toBeInTheDocument()
    })
  })

  it("search by name filters houses", async () => {
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Hus A")).toBeInTheDocument()
    })

    await user.type(
      screen.getByPlaceholderText(/søg efter hus eller beboer/i),
      "Peter",
    )

    await waitFor(() => {
      expect(screen.getByText("Hus A")).toBeInTheDocument()
      expect(screen.queryByText("Hus B")).not.toBeInTheDocument()
    })
  })

  it("search with no match shows empty state", async () => {
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Hus A")).toBeInTheDocument()
    })

    await user.type(
      screen.getByPlaceholderText(/søg efter hus eller beboer/i),
      "XYZ ingen match",
    )

    await waitFor(() => {
      expect(screen.getByText("Ingen huse fundet.")).toBeInTheDocument()
    })
  })

  it("clicking house card navigates to house detail", async () => {
    const user = userEvent.setup()
    render(<DirectoryPage />)

    await waitFor(() => {
      expect(screen.getByText("Hus A")).toBeInTheDocument()
    })

    await user.click(screen.getByText("Hus A"))

    expect(mockNavigate).toHaveBeenCalledWith("/beboere/hus/1")
  })
})
