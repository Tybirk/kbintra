/**
 * Messaging API functions
 */

import { apiClient, getAccessToken } from "./client"
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
    if (data.attachments && data.attachments.length > 0) {
      const formData = new FormData()
      data.participant_ids.forEach((id) => {
        formData.append("participant_ids", id.toString())
      })
      if (data.initial_message) {
        formData.append("initial_message", data.initial_message)
      }
      data.attachments.forEach((file) => {
        formData.append("attachments", file)
      })
      const response = await apiClient.post(
        "/messages/conversations/",
        formData,
        {
          headers: { "Content-Type": undefined },
        },
      )
      return response.data
    }
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
    attachments?: File[],
  ): Promise<Message> => {
    if (attachments && attachments.length > 0) {
      const formData = new FormData()
      formData.append("content", content)
      attachments.forEach((file) => {
        formData.append("attachments", file)
      })
      const response = await apiClient.post(
        `/messages/conversations/${conversationId}/messages/`,
        formData,
        { headers: { "Content-Type": undefined } },
      )
      return response.data
    }
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

  // Add participants to an existing conversation
  addParticipants: async (
    conversationId: number,
    userIds: number[],
  ): Promise<ConversationDetail> => {
    const response = await apiClient.post(
      `/messages/conversations/${conversationId}/add-participants/`,
      { user_ids: userIds },
    )
    return response.data
  },

  // Leave a conversation
  leaveConversation: async (conversationId: number): Promise<void> => {
    await apiClient.post(`/messages/conversations/${conversationId}/leave/`)
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
  baseReconnectDelay = 1000
  maxReconnectDelay = 5000
  messageHandlers: MessageHandler[] = []
  connectionHandlers: ConnectionHandler[] = []
  getToken: () => string | null
  reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  intentionalDisconnect = false
  private pingInterval: ReturnType<typeof setInterval> | null = null

  // Store event listener references for cleanup
  private visibilityHandler: (() => void) | null = null
  private onlineHandler: (() => void) | null = null
  private offlineHandler: (() => void) | null = null

  constructor(getToken: () => string | null) {
    this.getToken = getToken
  }

  private setupEventListeners(): void {
    // Reconnect when the tab becomes visible
    this.visibilityHandler = () => {
      if (document.visibilityState === "visible" && !this.isConnected) {
        console.log("Tab became visible, attempting reconnection")
        this.reconnectAttempts = 0 // Reset attempts on visibility change
        this.connect()
      }
    }
    document.addEventListener("visibilitychange", this.visibilityHandler)

    // Reconnect when the browser comes back online
    this.onlineHandler = () => {
      console.log("Browser came online, attempting reconnection")
      this.reconnectAttempts = 0 // Reset attempts when coming online
      this.connect()
    }
    window.addEventListener("online", this.onlineHandler)

    // Track offline state
    this.offlineHandler = () => {
      console.log("Browser went offline")
    }
    window.addEventListener("offline", this.offlineHandler)
  }

  private removeEventListeners(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler)
      this.visibilityHandler = null
    }
    if (this.onlineHandler) {
      window.removeEventListener("online", this.onlineHandler)
      this.onlineHandler = null
    }
    if (this.offlineHandler) {
      window.removeEventListener("offline", this.offlineHandler)
      this.offlineHandler = null
    }
  }

  private getReconnectDelay(): number {
    // Exponential backoff with jitter: base * 2^attempts + random jitter
    const exponentialDelay =
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts)
    const jitter = Math.random() * 1000
    return Math.min(exponentialDelay + jitter, this.maxReconnectDelay)
  }

  connect(): void {
    // Don't create a new connection if one already exists
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      return
    }

    // Setup event listeners lazily on first connect
    if (!this.visibilityHandler) {
      this.setupEventListeners()
    }

    // Clear any pending reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.intentionalDisconnect = false

    const token = this.getToken()
    if (!token) {
      return
    }

    // Use wss in production, ws in development
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.hostname
    const port = import.meta.env.DEV ? ":7000" : ""
    const url = `${protocol}//${host}${port}/ws/chat/?token=${token}`

    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      console.error("Failed to create WebSocket:", e)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      console.log("WebSocket connected")
      this.reconnectAttempts = 0 // Reset on successful connection
      this.startPing()
      this.notifyConnectionHandlers(true)
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Ignore pong responses
        if (data.type === "pong") return
        this.messageHandlers.forEach((handler) => handler(data))
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e)
      }
    }

    this.ws.onclose = (event) => {
      console.log("WebSocket disconnected:", event.code, event.reason)
      this.stopPing()
      this.notifyConnectionHandlers(false)
      this.ws = null

      // Only reconnect if this wasn't an intentional disconnect
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error)
      // onclose will be called after onerror, which will trigger reconnect
    }
  }

  private scheduleReconnect(): void {
    // Don't schedule if we're offline
    if (!navigator.onLine) {
      console.log("Browser is offline, will reconnect when online")
      return
    }

    const delay = this.getReconnectDelay()
    console.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${Math.round(delay)}ms`,
    )

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++
      this.connect()
    }, delay)
  }

  disconnect(): void {
    this.intentionalDisconnect = true

    this.stopPing()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.messageHandlers = []
    this.connectionHandlers = []

    // Clean up event listeners to prevent memory leaks
    this.removeEventListeners()
  }

  async sendMessage(
    conversationId: number,
    content: string,
    attachments?: File[],
  ): Promise<boolean> {
    // Always use REST API when attachments are present (WebSocket is text-only)
    if (attachments && attachments.length > 0) {
      try {
        await messagingApi.sendMessage(conversationId, content, attachments)
        return true
      } catch (error) {
        console.error("Failed to send message with attachments:", error)
        return false
      }
    }

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

  private startPing(): void {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "ping" }))
      }
    }, 30000)
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// Shared singleton — all components should use this instead of creating their own instances
export const chatWs = new ChatWebSocket(getAccessToken)
