import { describe, it, expect, vi, beforeEach } from "vitest"

import { forumApi } from "./forum"

import { apiClient } from "./client"

// Mock the apiClient

vi.mock("./client", () => ({
  apiClient: {
    get: vi.fn(),

    post: vi.fn(),

    patch: vi.fn(),

    delete: vi.fn(),
  },
}))

describe("forumApi", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("Subgroups", () => {
    it("should fetch subgroups", async () => {
      const mockSubgroups = [{ id: 1, name: "Test Group", slug: "test-group" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockSubgroups },
      })

      const result = await forumApi.getSubgroups()

      expect(apiClient.get).toHaveBeenCalledWith("/forum/subgroups/")

      expect(result).toEqual(mockSubgroups)
    })

    it("should fetch single subgroup by slug", async () => {
      const mockSubgroup = { id: 1, name: "Test Group", slug: "test-group" }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockSubgroup })

      const result = await forumApi.getSubgroup("test-group")

      expect(apiClient.get).toHaveBeenCalledWith("/forum/subgroups/test-group/")

      expect(result).toEqual(mockSubgroup)
    })

    it("should subscribe to subgroup", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { detail: "Subscribed" },
      })

      const result = await forumApi.subscribe("test-group")

      expect(apiClient.post).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/subscribe/",
      )

      expect(result).toEqual({ detail: "Subscribed" })
    })

    it("should unsubscribe from subgroup", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { detail: "Unsubscribed" },
      })

      const result = await forumApi.unsubscribe("test-group")

      expect(apiClient.post).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/unsubscribe/",
      )

      expect(result).toEqual({ detail: "Unsubscribed" })
    })

    it("should fetch subscriptions", async () => {
      const mockSubs = [{ id: 1, subgroup: "test-group" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockSubs },
      })

      const result = await forumApi.getMySubscriptions()

      expect(apiClient.get).toHaveBeenCalledWith("/forum/subscriptions/")

      expect(result).toEqual(mockSubs)
    })
  })

  describe("Threads", () => {
    it("should fetch threads for subgroup", async () => {
      const mockThreads = [{ id: 1, title: "Test Thread" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: mockThreads,
        },
      })

      const result = await forumApi.getThreads("test-group")

      expect(apiClient.get).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/threads/",
        { params: {} },
      )
      expect(result).toEqual(mockThreads)
    })

    it("should fetch single thread", async () => {
      const mockThread = { id: 1, title: "Test Thread", posts: [] }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockThread })

      const result = await forumApi.getThread(1)

      expect(apiClient.get).toHaveBeenCalledWith("/forum/threads/1/")

      expect(result).toEqual(mockThread)
    })

    it("should create thread", async () => {
      const mockThread = { id: 1, title: "New Thread" }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockThread })

      const result = await forumApi.createThread("test-group", {
        title: "New Thread",

        content: "Thread content",
      })

      expect(apiClient.post).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/threads/",

        {
          title: "New Thread",

          content: "Thread content",
        },
      )

      expect(result).toEqual(mockThread)
    })

    it("should delete thread", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await forumApi.deleteThread(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/forum/threads/1/delete/")
    })
  })

  describe("Posts", () => {
    it("should fetch posts for thread", async () => {
      const mockPosts = [{ id: 1, content: "Test Post" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockPosts },
      })

      const result = await forumApi.getPosts(1)

      expect(apiClient.get).toHaveBeenCalledWith("/forum/threads/1/posts/")

      expect(result).toEqual(mockPosts)
    })

    it("should create post", async () => {
      const mockPost = { id: 1, content: "New Post" }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockPost })

      const result = await forumApi.createPost(1, { content: "New Post" })

      expect(apiClient.post).toHaveBeenCalledWith("/forum/threads/1/posts/", {
        content: "New Post",
      })

      expect(result).toEqual(mockPost)
    })

    it("should update post", async () => {
      const mockPost = { id: 1, content: "Updated Post" }

      vi.mocked(apiClient.patch).mockResolvedValue({ data: mockPost })

      const result = await forumApi.updatePost(1, { content: "Updated Post" })

      expect(apiClient.patch).toHaveBeenCalledWith("/forum/posts/1/", {
        content: "Updated Post",
      })

      expect(result).toEqual(mockPost)
    })

    it("should delete post", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await forumApi.deletePost(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/forum/posts/1/")
    })
  })

  describe("Folders", () => {
    it("should fetch root folders", async () => {
      const mockFolders = [{ id: 1, name: "Documents" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockFolders },
      })

      const result = await forumApi.getFolders("test-group")

      expect(apiClient.get).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/folders/",

        {
          params: {},
        },
      )

      expect(result).toEqual(mockFolders)
    })

    it("should fetch folders with parent", async () => {
      const mockFolders = [{ id: 2, name: "Subfolder" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockFolders },
      })

      const result = await forumApi.getFolders("test-group", 1)

      expect(apiClient.get).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/folders/",

        {
          params: { parent: 1 },
        },
      )

      expect(result).toEqual(mockFolders)
    })

    it("should fetch single folder", async () => {
      const mockFolder = { id: 1, name: "Documents" }

      vi.mocked(apiClient.get).mockResolvedValue({ data: mockFolder })

      const result = await forumApi.getFolder(1)

      expect(apiClient.get).toHaveBeenCalledWith("/forum/folders/1/")

      expect(result).toEqual(mockFolder)
    })

    it("should create folder", async () => {
      const mockFolder = { id: 1, name: "New Folder" }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockFolder })

      const result = await forumApi.createFolder("test-group", "New Folder")

      expect(apiClient.post).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/folders/",

        {
          name: "New Folder",

          parent: null,
        },
      )

      expect(result).toEqual(mockFolder)
    })

    it("should create folder with parent", async () => {
      const mockFolder = { id: 2, name: "Subfolder" }

      vi.mocked(apiClient.post).mockResolvedValue({ data: mockFolder })

      const result = await forumApi.createFolder("test-group", "Subfolder", 1)

      expect(apiClient.post).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/folders/",

        {
          name: "Subfolder",

          parent: 1,
        },
      )

      expect(result).toEqual(mockFolder)
    })
  })

  describe("Files", () => {
    it("should fetch files in folder", async () => {
      const mockFiles = [{ id: 1, name: "document.pdf" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockFiles },
      })

      const result = await forumApi.getFiles(1)

      expect(apiClient.get).toHaveBeenCalledWith("/forum/folders/1/files/")

      expect(result).toEqual(mockFiles)
    })

    it("should fetch root files", async () => {
      const mockFiles = [{ id: 1, name: "readme.txt" }]

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { results: mockFiles },
      })

      const result = await forumApi.getRootFiles("test-group")

      expect(apiClient.get).toHaveBeenCalledWith(
        "/forum/subgroups/test-group/files/",
      )

      expect(result).toEqual(mockFiles)
    })

    it("should delete file", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({})

      await forumApi.deleteFile(1)

      expect(apiClient.delete).toHaveBeenCalledWith("/forum/files/1/")
    })

    it("should move file", async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { detail: "File moved" },
      })

      const result = await forumApi.moveFile(1, 2)

      expect(apiClient.patch).toHaveBeenCalledWith("/forum/files/1/move/", {
        folder_id: 2,
      })

      expect(result).toEqual({ detail: "File moved" })
    })

    it("should move file to root", async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: { detail: "File moved" },
      })

      const result = await forumApi.moveFile(1, null)

      expect(apiClient.patch).toHaveBeenCalledWith("/forum/files/1/move/", {
        folder_id: null,
      })

      expect(result).toEqual({ detail: "File moved" })
    })
  })
})
