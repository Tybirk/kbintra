/**
 * Messaging API functions
 */

import { apiClient } from "./client"
import type {
  Conversation,
  ConversationDetail,
  CreateConversationData,
  Message,
} from "../types"

export const messagingApi = {
  // Get all conversations for current user
  getConversations: async (): Promise<Conversation[]> => {
    const response = await apiClient.get("/messages/conversations/")
    // Handle paginated response
    return response.data.results ?? response.data
  },

  // Get conversation with messages
  getConversation: async (id: number): Promise<ConversationDetail> => {
    const response = await apiClient.get(`/messages/conversations/${id}/`)
    return response.data
  },

  // Create new conversation (or return existing one for 1-on-1)
  createConversation: async (
    data: CreateConversationData,
  ): Promise<ConversationDetail> => {
    const response = await apiClient.post("/messages/conversations/", data)
    return response.data
  },

  // Get messages in a conversation
  getMessages: async (conversationId: number): Promise<Message[]> => {
    const response = await apiClient.get(
      `/messages/conversations/${conversationId}/messages/`,
    )
    // Handle paginated response
    return response.data.results ?? response.data
  },

  // Send a message (REST API fallback)
  sendMessage: async (
    conversationId: number,
    content: string,
  ): Promise<Message> => {
    const response = await apiClient.post(
      `/messages/conversations/${conversationId}/messages/`,
      { content },
    )
    return response.data
  },

  // Mark messages as read
  markAsRead: async (conversationId: number): Promise<{
    marked_read: number
  }> => {
    const response = await apiClient.post(
      `/messages/conversations/${conversationId}/read/`,
    )
    return response.data
  },

  // Get total unread count
  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    const response = await apiClient.get("/messages/unread-count/")
    return response.data
  },
}

/**
 * WebSocket connection manager for real-time messaging
 */
type MessageHandler = (data: unknown) => void
type ConnectionHandler = (connected: boolean) => void

export class ChatWebSocket {
  ws: WebSocket | null = null
  reconnectAttempts = 0
  maxReconnectAttempts = 5
  reconnectDelay = 1000
  messageHandlers: MessageHandler[] = []
  connectionHandlers: ConnectionHandler[] = []
  getToken: () => string | null

  constructor(getToken: () => string | null) {
    this.getToken = getToken
  }

  connect(): void {
    const token = this.getToken()
    if (!token) {
      console.error("No token available for WebSocket connection")
      return
    }

    // Use wss in production, ws in development
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.hostname
    const port = import.meta.env.DEV ? ":7000" : ""
    const url = `${protocol}//${host}${port}/ws/chat/?token=${token}`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log("WebSocket connected")
      this.reconnectAttempts = 0
      this.notifyConnectionHandlers(true)
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.messageHandlers.forEach((handler) => handler(data))
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e)
      }
    }

    this.ws.onclose = (event) => {
      console.log("WebSocket disconnected:", event.code)
      this.notifyConnectionHandlers(false)
      this.ws = null

      // Attempt to reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        setTimeout(
          () => this.connect(),
          this.reconnectDelay * this.reconnectAttempts,
        )
      }
    }

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error)
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageHandlers = []
    this.connectionHandlers = []
  }

  async sendMessage(conversationId: number, content: string): Promise<boolean> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: "send_message",
          conversation_id: conversationId,
          content,
        }),
      )
      return true
    } else {
      // Fallback to REST API if WebSocket is not connected
      console.warn("WebSocket not connected, falling back to REST API")
      try {
        await messagingApi.sendMessage(conversationId, content)
        return true
      } catch (error) {
        console.error("Failed to send message via REST API:", error)
        return false
      }
    }
  }

  markRead(conversationId: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: "mark_read",
          conversation_id: conversationId,
        }),
      )
    }
  }

  sendTyping(conversationId: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: "typing",
          conversation_id: conversationId,
        }),
      )
    }
  }

  joinConversation(conversationId: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: "join_conversation",
          conversation_id: conversationId,
        }),
      )
    }
  }

  onMessage(handler: (data: unknown) => void): () => void {
    this.messageHandlers.push(handler)
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler)
    }
  }

  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.push(handler)
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(
        (h) => h !== handler,
      )
    }
  }

  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach((handler) => handler(connected))
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
