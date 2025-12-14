import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messagingApi } from './messaging';
import { apiClient } from './client';

// Mock the apiClient
vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('messagingApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConversations', () => {
    it('should fetch all conversations', async () => {
      const mockConversations = [
        { id: 1, participants: [], last_message: null },
        { id: 2, participants: [], last_message: null },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: { results: mockConversations } });

      const result = await messagingApi.getConversations();

      expect(apiClient.get).toHaveBeenCalledWith('/messages/conversations/');
      expect(result).toEqual(mockConversations);
    });

    it('should handle non-paginated response', async () => {
      const mockConversations = [{ id: 1, participants: [] }];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockConversations });

      const result = await messagingApi.getConversations();

      expect(result).toEqual(mockConversations);
    });
  });

  describe('getConversation', () => {
    it('should fetch single conversation', async () => {
      const mockConversation = { id: 1, participants: [], messages: [] };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockConversation });

      const result = await messagingApi.getConversation(1);

      expect(apiClient.get).toHaveBeenCalledWith('/messages/conversations/1/');
      expect(result).toEqual(mockConversation);
    });
  });

  describe('createConversation', () => {
    it('should create new conversation', async () => {
      const mockConversation = { id: 1, participants: [1, 2], messages: [] };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockConversation });

      const result = await messagingApi.createConversation({
        participant_ids: [2],
        initial_message: 'Hello!',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/messages/conversations/', {
        participant_ids: [2],
        initial_message: 'Hello!',
      });
      expect(result).toEqual(mockConversation);
    });
  });

  describe('getMessages', () => {
    it('should fetch messages for conversation', async () => {
      const mockMessages = [
        { id: 1, content: 'Hello', sender: 1 },
        { id: 2, content: 'Hi there', sender: 2 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: { results: mockMessages } });

      const result = await messagingApi.getMessages(1);

      expect(apiClient.get).toHaveBeenCalledWith('/messages/conversations/1/messages/');
      expect(result).toEqual(mockMessages);
    });
  });

  describe('sendMessage', () => {
    it('should send message to conversation', async () => {
      const mockMessage = { id: 3, content: 'New message', sender: 1 };
      vi.mocked(apiClient.post).mockResolvedValue({ data: mockMessage });

      const result = await messagingApi.sendMessage(1, 'New message');

      expect(apiClient.post).toHaveBeenCalledWith('/messages/conversations/1/messages/', {
        content: 'New message',
      });
      expect(result).toEqual(mockMessage);
    });
  });

  describe('markAsRead', () => {
    it('should mark messages as read', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { marked_read: 5 } });

      const result = await messagingApi.markAsRead(1);

      expect(apiClient.post).toHaveBeenCalledWith('/messages/conversations/1/read/');
      expect(result).toEqual({ marked_read: 5 });
    });
  });

  describe('getUnreadCount', () => {
    it('should fetch unread message count', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { unread_count: 3 } });

      const result = await messagingApi.getUnreadCount();

      expect(apiClient.get).toHaveBeenCalledWith('/messages/unread-count/');
      expect(result).toEqual({ unread_count: 3 });
    });

    it('should return zero when no unread messages', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { unread_count: 0 } });

      const result = await messagingApi.getUnreadCount();

      expect(result.unread_count).toBe(0);
    });
  });
});
