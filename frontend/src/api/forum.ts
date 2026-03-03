/**
 * Forum API functions
 */

import { apiClient } from "./client"
import type {
  Subgroup,
  SubgroupSubscription,
  Thread,
  ThreadDetail,
  CreateThreadData,
  Post,
  CreatePostData,
  CreatePollData,
  Poll,
  Folder,
  ForumFile,
  RecentActivity,
  ReactionType,
  ReactionTypeInfo,
} from "../types"

export const forumApi = {
  // Recent activity
  getRecentActivity: async (limit = 10): Promise<RecentActivity[]> => {
    const response = await apiClient.get(`/forum/recent/?limit=${limit}`)
    return response.data
  },

  // Subgroups
  getSubgroups: async (): Promise<Subgroup[]> => {
    const response = await apiClient.get("/forum/subgroups/")
    return response.data.results ?? response.data
  },

  getSubgroup: async (slug: string): Promise<Subgroup> => {
    const response = await apiClient.get(`/forum/subgroups/${slug}/`)
    return response.data
  },

  subscribe: async (slug: string): Promise<{ detail: string }> => {
    const response = await apiClient.post(`/forum/subgroups/${slug}/subscribe/`)
    return response.data
  },

  unsubscribe: async (slug: string): Promise<{ detail: string }> => {
    const response = await apiClient.post(
      `/forum/subgroups/${slug}/unsubscribe/`,
    )
    return response.data
  },

  getMySubscriptions: async (): Promise<SubgroupSubscription[]> => {
    const response = await apiClient.get("/forum/subscriptions/")
    return response.data.results ?? response.data
  },

  // Threads
  getThreads: async (subgroupSlug: string): Promise<Thread[]> => {
    const response = await apiClient.get(
      `/forum/subgroups/${subgroupSlug}/threads/`,
    )
    return response.data.results ?? response.data
  },

  getThread: async (threadId: number): Promise<ThreadDetail> => {
    const response = await apiClient.get(`/forum/threads/${threadId}/`)
    return response.data
  },

  getThreadBySlug: async (
    subgroupSlug: string,
    threadSlug: string,
  ): Promise<ThreadDetail> => {
    const response = await apiClient.get(
      `/forum/subgroups/${subgroupSlug}/threads/${threadSlug}/`,
    )
    return response.data
  },

  createThread: async (
    subgroupSlug: string,
    data: CreateThreadData,
    attachments?: File[],
    pollData?: CreatePollData,
  ): Promise<Thread> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData()
      formData.append("title", data.title)
      formData.append("content", data.content)
      attachments.forEach((file) => {
        formData.append("attachments", file)
      })
      if (pollData) {
        formData.append("poll_data", JSON.stringify(pollData))
      }
      // Don't set Content-Type header - let browser set it with boundary
      const response = await apiClient.post(
        `/forum/subgroups/${subgroupSlug}/threads/`,
        formData,
        {
          headers: {
            "Content-Type": undefined,
          },
        },
      )
      return response.data
    }
    const payload: Record<string, unknown> = { ...data }
    if (pollData) {
      payload.poll_data = pollData
    }
    const response = await apiClient.post(
      `/forum/subgroups/${subgroupSlug}/threads/`,
      payload,
    )
    return response.data
  },

  deleteThread: async (threadId: number): Promise<void> => {
    await apiClient.delete(`/forum/threads/${threadId}/delete/`)
  },

  closeThread: async (threadId: number, isClosed?: boolean): Promise<{
    detail: string
    is_closed: boolean
  }> => {
    const response = await apiClient.post(`/forum/threads/${threadId}/close/`, {
      is_closed: isClosed,
    })
    return response.data
  },

  moveThread: async (threadId: number, subgroupSlug: string): Promise<{
    detail: string
    subgroup_slug: string
    thread_slug: string
  }> => {
    const response = await apiClient.post(`/forum/threads/${threadId}/move/`, {
      subgroup_slug: subgroupSlug,
    })
    return response.data
  },

  muteThread: async (threadId: number): Promise<{ is_muted: boolean }> => {
    const response = await apiClient.post(`/forum/threads/${threadId}/mute/`)
    return response.data
  },

  // Posts
  getPosts: async (threadId: number): Promise<Post[]> => {
    const response = await apiClient.get(`/forum/threads/${threadId}/posts/`)
    return response.data.results ?? response.data
  },

  createPost: async (
    threadId: number,
    data: CreatePostData,
    attachments?: File[],
    pollData?: CreatePollData,
  ): Promise<Post> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData()
      formData.append("content", data.content)
      attachments.forEach((file) => {
        formData.append("attachments", file)
      })
      if (pollData) {
        formData.append("poll_data", JSON.stringify(pollData))
      }
      // Don't set Content-Type header - let browser set it with boundary
      const response = await apiClient.post(
        `/forum/threads/${threadId}/posts/`,
        formData,
        {
          headers: {
            "Content-Type": undefined,
          },
        },
      )
      return response.data
    }
    const payload: Record<string, unknown> = { ...data }
    if (pollData) {
      payload.poll_data = pollData
    }
    const response = await apiClient.post(
      `/forum/threads/${threadId}/posts/`,
      payload,
    )
    return response.data
  },

  updateThread: async (
    threadId: number,
    data: { title: string },
  ): Promise<void> => {
    await apiClient.patch(`/forum/threads/${threadId}/update/`, data)
  },

  updatePost: async (postId: number, data: CreatePostData): Promise<Post> => {
    const response = await apiClient.patch(`/forum/posts/${postId}/`, data)
    return response.data
  },

  deletePost: async (postId: number): Promise<void> => {
    await apiClient.delete(`/forum/posts/${postId}/`)
  },

  // Folders
  getFolders: async (
    subgroupSlug: string,
    parentId?: number,
  ): Promise<Folder[]> => {
    const params = parentId ? { parent: parentId } : {}
    const response = await apiClient.get(
      `/forum/subgroups/${subgroupSlug}/folders/`,
      { params },
    )
    return response.data.results ?? response.data
  },

  getFolder: async (folderId: number): Promise<Folder> => {
    const response = await apiClient.get(`/forum/folders/${folderId}/`)
    return response.data
  },

  getFolderBySlug: async (
    subgroupSlug: string,
    folderSlug: string,
  ): Promise<Folder> => {
    const response = await apiClient.get(
      `/forum/subgroups/${subgroupSlug}/folder/${folderSlug}/`,
    )
    return response.data
  },

  createFolder: async (
    subgroupSlug: string,
    name: string,
    parentId?: number,
  ): Promise<Folder> => {
    const response = await apiClient.post(
      `/forum/subgroups/${subgroupSlug}/folders/`,
      {
        name,
        parent: parentId || null,
      },
    )
    return response.data
  },

  // Files
  getFiles: async (folderId: number): Promise<ForumFile[]> => {
    const response = await apiClient.get(`/forum/folders/${folderId}/files/`)
    return response.data.results ?? response.data
  },

  getRootFiles: async (subgroupSlug: string): Promise<ForumFile[]> => {
    const response = await apiClient.get(
      `/forum/subgroups/${subgroupSlug}/files/`,
    )
    return response.data.results ?? response.data
  },

  uploadFile: async (
    folderId: number,
    file: File,
    name?: string,
  ): Promise<ForumFile> => {
    const formData = new FormData()
    formData.append("file", file)
    if (name) {
      formData.append("name", name)
    }
    // Don't set Content-Type header - let browser set it with boundary
    const response = await apiClient.post(
      `/forum/folders/${folderId}/files/`,
      formData,
      {
        headers: {
          "Content-Type": undefined,
        },
      },
    )
    return response.data
  },

  uploadRootFile: async (
    subgroupSlug: string,
    file: File,
    name?: string,
  ): Promise<ForumFile> => {
    const formData = new FormData()
    formData.append("file", file)
    if (name) {
      formData.append("name", name)
    }
    // Don't set Content-Type header - let browser set it with boundary
    const response = await apiClient.post(
      `/forum/subgroups/${subgroupSlug}/files/`,
      formData,
      {
        headers: {
          "Content-Type": undefined,
        },
      },
    )
    return response.data
  },

  deleteFile: async (fileId: number): Promise<void> => {
    await apiClient.delete(`/forum/files/${fileId}/`)
  },

  downloadFolder: async (
    folderId: number,
    folderName: string,
  ): Promise<void> => {
    const response = await apiClient.get(
      `/forum/folders/${folderId}/download/`,
      { responseType: "blob" },
    )
    const url = URL.createObjectURL(response.data as Blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${folderName}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  },

  moveFile: async (fileId: number, folderId: number | null): Promise<{
    detail: string
  }> => {
    const response = await apiClient.patch(`/forum/files/${fileId}/move/`, {
      folder_id: folderId,
    })
    return response.data
  },

  // Get all folders in a subgroup (flat list for move dialog)
  getAllFolders: async (subgroupSlug: string): Promise<Folder[]> => {
    // Get root folders first, then recursively get subfolders
    const rootFolders = await forumApi.getFolders(subgroupSlug)
    const allFolders: Folder[] = [...rootFolders]

    // Helper to get subfolders recursively
    const getSubfolders = async (parentId: number): Promise<void> => {
      const subfolders = await forumApi.getFolders(subgroupSlug, parentId)
      allFolders.push(...subfolders)
      for (const folder of subfolders) {
        if (folder.subfolder_count > 0) {
          await getSubfolders(folder.id)
        }
      }
    }

    for (const folder of rootFolders) {
      if (folder.subfolder_count > 0) {
        await getSubfolders(folder.id)
      }
    }

    return allFolders
  },

  // Reactions
  toggleReaction: async (postId: number, reactionType: ReactionType): Promise<{
    detail: string
    action: "added" | "removed"
  }> => {
    const response = await apiClient.post(`/forum/posts/${postId}/react/`, {
      reaction_type: reactionType,
    })
    return response.data
  },

  getReactionTypes: async (): Promise<ReactionTypeInfo[]> => {
    const response = await apiClient.get("/forum/reactions/types/")
    return response.data
  },

  // Polls
  votePoll: async (pollId: number, optionId: number): Promise<{
    detail: string
    action: "added" | "removed"
  }> => {
    const response = await apiClient.post(`/forum/polls/${pollId}/vote/`, {
      option_id: optionId,
    })
    return response.data
  },

  updatePoll: async (pollId: number, data: CreatePollData): Promise<Poll> => {
    const response = await apiClient.patch(`/forum/polls/${pollId}/`, data)
    return response.data
  },

  deletePoll: async (pollId: number): Promise<void> => {
    await apiClient.delete(`/forum/polls/${pollId}/`)
  },

  // Read status
  markAllRead: async (): Promise<{ detail: string }> => {
    const response = await apiClient.post("/forum/mark-all-read/")
    return response.data
  },

  markSubgroupRead: async (slug: string): Promise<{ detail: string }> => {
    const response = await apiClient.post(`/forum/subgroups/${slug}/mark-read/`)
    return response.data
  },

  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    const response = await apiClient.get("/forum/unread-count/")
    return response.data
  },
}
