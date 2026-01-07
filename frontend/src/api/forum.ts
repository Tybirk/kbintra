/**
 * Forum API functions
 */

import { apiClient } from './client';
import type {
  Subgroup,
  SubgroupSubscription,
  Thread,
  ThreadDetail,
  CreateThreadData,
  Post,
  CreatePostData,
  Folder,
  ForumFile,
} from '../types';

export const forumApi = {
  // Subgroups
  getSubgroups: async (): Promise<Subgroup[]> => {
    const response = await apiClient.get('/forum/subgroups/');
    return response.data.results ?? response.data;
  },

  getSubgroup: async (slug: string): Promise<Subgroup> => {
    const response = await apiClient.get(`/forum/subgroups/${slug}/`);
    return response.data;
  },

  subscribe: async (slug: string): Promise<{ detail: string }> => {
    const response = await apiClient.post(`/forum/subgroups/${slug}/subscribe/`);
    return response.data;
  },

  unsubscribe: async (slug: string): Promise<{ detail: string }> => {
    const response = await apiClient.post(`/forum/subgroups/${slug}/unsubscribe/`);
    return response.data;
  },

  getMySubscriptions: async (): Promise<SubgroupSubscription[]> => {
    const response = await apiClient.get('/forum/subscriptions/');
    return response.data.results ?? response.data;
  },

  // Threads
  getThreads: async (subgroupSlug: string): Promise<Thread[]> => {
    const response = await apiClient.get(`/forum/subgroups/${subgroupSlug}/threads/`);
    return response.data.results ?? response.data;
  },

  getThread: async (threadId: number): Promise<ThreadDetail> => {
    const response = await apiClient.get(`/forum/threads/${threadId}/`);
    return response.data;
  },

  createThread: async (
    subgroupSlug: string,
    data: CreateThreadData,
    attachments?: File[]
  ): Promise<Thread> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData();
      formData.append('title', data.title);
      formData.append('content', data.content);
      attachments.forEach((file) => {
        formData.append('attachments', file);
      });
      // Don't set Content-Type header - let browser set it with boundary
      const response = await apiClient.post(`/forum/subgroups/${subgroupSlug}/threads/`, formData, {
        headers: {
          'Content-Type': undefined,
        },
      });
      return response.data;
    }
    const response = await apiClient.post(`/forum/subgroups/${subgroupSlug}/threads/`, data);
    return response.data;
  },

  deleteThread: async (threadId: number): Promise<void> => {
    await apiClient.delete(`/forum/threads/${threadId}/delete/`);
  },

  // Posts
  getPosts: async (threadId: number): Promise<Post[]> => {
    const response = await apiClient.get(`/forum/threads/${threadId}/posts/`);
    return response.data.results ?? response.data;
  },

  createPost: async (threadId: number, data: CreatePostData, attachments?: File[]): Promise<Post> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData();
      formData.append('content', data.content);
      attachments.forEach((file) => {
        formData.append('attachments', file);
      });
      // Don't set Content-Type header - let browser set it with boundary
      const response = await apiClient.post(`/forum/threads/${threadId}/posts/`, formData, {
        headers: {
          'Content-Type': undefined,
        },
      });
      return response.data;
    }
    const response = await apiClient.post(`/forum/threads/${threadId}/posts/`, data);
    return response.data;
  },

  updatePost: async (postId: number, data: CreatePostData): Promise<Post> => {
    const response = await apiClient.patch(`/forum/posts/${postId}/`, data);
    return response.data;
  },

  deletePost: async (postId: number): Promise<void> => {
    await apiClient.delete(`/forum/posts/${postId}/`);
  },

  // Folders
  getFolders: async (subgroupSlug: string, parentId?: number): Promise<Folder[]> => {
    const params = parentId ? { parent: parentId } : {};
    const response = await apiClient.get(`/forum/subgroups/${subgroupSlug}/folders/`, { params });
    return response.data.results ?? response.data;
  },

  getFolder: async (folderId: number): Promise<Folder> => {
    const response = await apiClient.get(`/forum/folders/${folderId}/`);
    return response.data;
  },

  createFolder: async (subgroupSlug: string, name: string, parentId?: number): Promise<Folder> => {
    const response = await apiClient.post(`/forum/subgroups/${subgroupSlug}/folders/`, {
      name,
      parent: parentId || null,
    });
    return response.data;
  },

  // Files
  getFiles: async (folderId: number): Promise<ForumFile[]> => {
    const response = await apiClient.get(`/forum/folders/${folderId}/files/`);
    return response.data.results ?? response.data;
  },

  getRootFiles: async (subgroupSlug: string): Promise<ForumFile[]> => {
    const response = await apiClient.get(`/forum/subgroups/${subgroupSlug}/files/`);
    return response.data.results ?? response.data;
  },

  uploadFile: async (folderId: number, file: File, name?: string): Promise<ForumFile> => {
    const formData = new FormData();
    formData.append('file', file);
    if (name) {
      formData.append('name', name);
    }
    // Don't set Content-Type header - let browser set it with boundary
    const response = await apiClient.post(`/forum/folders/${folderId}/files/`, formData, {
      headers: {
        'Content-Type': undefined,
      },
    });
    return response.data;
  },

  uploadRootFile: async (subgroupSlug: string, file: File, name?: string): Promise<ForumFile> => {
    const formData = new FormData();
    formData.append('file', file);
    if (name) {
      formData.append('name', name);
    }
    // Don't set Content-Type header - let browser set it with boundary
    const response = await apiClient.post(`/forum/subgroups/${subgroupSlug}/files/`, formData, {
      headers: {
        'Content-Type': undefined,
      },
    });
    return response.data;
  },

  deleteFile: async (fileId: number): Promise<void> => {
    await apiClient.delete(`/forum/files/${fileId}/`);
  },

  moveFile: async (fileId: number, folderId: number | null): Promise<{ detail: string }> => {
    const response = await apiClient.patch(`/forum/files/${fileId}/move/`, {
      folder_id: folderId,
    });
    return response.data;
  },

  // Get all folders in a subgroup (flat list for move dialog)
  getAllFolders: async (subgroupSlug: string): Promise<Folder[]> => {
    // Get root folders first, then recursively get subfolders
    const rootFolders = await forumApi.getFolders(subgroupSlug);
    const allFolders: Folder[] = [...rootFolders];

    // Helper to get subfolders recursively
    const getSubfolders = async (parentId: number): Promise<void> => {
      const subfolders = await forumApi.getFolders(subgroupSlug, parentId);
      allFolders.push(...subfolders);
      for (const folder of subfolders) {
        if (folder.subfolder_count > 0) {
          await getSubfolders(folder.id);
        }
      }
    };

    for (const folder of rootFolders) {
      if (folder.subfolder_count > 0) {
        await getSubfolders(folder.id);
      }
    }

    return allFolders;
  },
};
