/**
 * Type definitions for KB Intra
 */

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  birthdate: string | null;
  profile_picture: string | null;
  bio: string;
  house: number | null;
  house_name: string | null;
  house_inhabitant_count: number;
  is_staff: boolean;
  date_joined: string;
}

export interface Child {
  id: number;
  name: string;
  birthdate: string | null;
  created_at: string;
}

export interface House {
  id: number;
  name: string;
  description: string;
  address: string;
  profile_picture: string | null;
  inhabitant_count: number;
  inhabitants?: UserSummary[];
  children?: Child[];
  created_at: string;
}

export interface UserSummary {
  id: number;
  first_name: string;
  last_name: string;
  profile_picture: string | null;
  bio: string;
}

export interface Invitation {
  id: number;
  email: string;
  token: string;
  house: number;
  house_name: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  used_at: string | null;
  expires_at: string;
  is_valid: boolean;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  token: string;
  email: string;
  password: string;
  password_confirm: string;
  first_name: string;
  last_name: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Forum Types
export interface Author {
  id: number;
  first_name: string;
  last_name: string;
  profile_picture: string | null;
}

export interface Subgroup {
  id: number;
  name: string;
  description: string;
  slug: string;
  is_default: boolean;
  is_committee: boolean;
  thread_count: number;
  is_subscribed: boolean;
  created_at: string;
  last_activity_at: string | null;
}

export interface SubgroupSubscription {
  id: number;
  subgroup: Subgroup;
  notify_new_threads: boolean;
  notify_replies: boolean;
  created_at: string;
}

export interface Post {
  id: number;
  thread: number;
  author: Author;
  content: string;
  is_own: boolean;
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: number;
  subgroup: number;
  title: string;
  author: Author;
  is_pinned: boolean;
  post_count: number;
  last_post_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadDetail extends Thread {
  subgroup_name: string;
  is_own: boolean;
  posts: Post[];
}

export interface CreateThreadData {
  title: string;
  content: string;
}

export interface CreatePostData {
  content: string;
}

export interface Folder {
  id: number;
  name: string;
  parent: number | null;
  file_count: number;
  subfolder_count: number;
  created_at: string;
}

export interface ForumFile {
  id: number;
  name: string;
  file: string;
  file_url: string;
  uploaded_by: Author;
  is_own: boolean;
  uploaded_at: string;
}

// Announcement Types
export interface Announcement {
  id: number;
  title: string;
  content: string;
  author: Author;
  is_active: boolean;
  priority: number;
  is_own: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnouncementData {
  title: string;
  content: string;
  is_active?: boolean;
  priority?: number;
}

// Food Types
export type DiningOption = 'eat_in' | 'take_away';
export type SeatingTime = '17:30' | '18:30';

export interface MenuTemplate {
  id: number;
  name: string;
  description: string;
  has_meat_option: boolean;
  meat_description: string;
  vegetarian_description: string;
  created_at: string;
  updated_at: string;
}

export interface MenuTemplateSimple {
  id: number;
  name: string;
}

export interface CreateMenuTemplateData {
  name: string;
  description?: string;
  has_meat_option?: boolean;
  meat_description?: string;
  vegetarian_description?: string;
}

export interface DailyMenu {
  id: number;
  date: string;
  day_of_week: number;
  day_name: string;
  template: MenuTemplateSimple | null;
  menu_name: string;
  description: string;
  effective_description: string;
  has_meat_option: boolean;
  meat_description: string;
  effective_meat_description: string;
  vegetarian_description: string;
  effective_vegetarian_description: string;
}

export interface UpdateDailyMenuData {
  template_id?: number | null;
  description?: string;
  has_meat_option?: boolean;
  meat_description?: string;
  vegetarian_description?: string;
}

export interface WeeklyMenu {
  id: number;
  week_start_date: string;
  daily_menus: DailyMenu[];
  created_by: Author | null;
  created_at: string;
  updated_at: string;
}

export interface MealPreference {
  id: number;
  day_of_week: number;
  day_name: string;
  adults_count: number;
  children_count: number;
  prefers_meat: boolean;
  dining_option: DiningOption;
  seating_time: SeatingTime;
}

export interface CreateMealPreferenceData {
  day_of_week: number;
  adults_count: number;
  children_count: number;
  prefers_meat: boolean;
  dining_option: DiningOption;
  seating_time: SeatingTime;
}

export interface HouseSimple {
  id: number;
  name: string;
}

export interface MealRegistration {
  id: number;
  date: string;
  day_of_week: number;
  day_name: string;
  adults_count: number;
  children_count: number;
  meal_type: 'meat' | 'vegetarian';
  dining_option: DiningOption;
  seating_time: SeatingTime;
  house: HouseSimple | null;
  is_active: boolean;
  total_portions: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMealRegistrationData {
  date: string;
  adults_count: number;
  children_count: number;
  meal_type: 'meat' | 'vegetarian';
  dining_option: DiningOption;
  seating_time: SeatingTime;
  house_id?: number | null;
  is_active?: boolean;
}

export interface RegistrationCount {
  adults: number;
  children: number;
}

export interface DailyRegistrationStats {
  date: string;
  takeaway: RegistrationCount;
  eat_in_1730: RegistrationCount;
  eat_in_1830: RegistrationCount;
  total: RegistrationCount;
}

export interface WeeklyRegistrationStats {
  [date: string]: DailyRegistrationStats;
}

export interface TicketOwner extends Author {
  phone_number: string;
}

export interface FoodTicket {
  id: number;
  owner: TicketOwner;
  date: string;
  day_of_week: number;
  day_name: string;
  adults_count: number;
  children_count: number;
  meal_type: 'meat' | 'vegetarian';
  price: string | null;
  is_free: boolean;
  description: string;
  is_available: boolean;
  claimed_by: TicketOwner | null;
  claimed_at: string | null;
  total_portions: number;
  is_own: boolean;
  created_at: string;
}

export interface CreateFoodTicketData {
  date: string;
  adults_count: number;
  children_count: number;
  meal_type: 'meat' | 'vegetarian';
  price?: number | null;
  description?: string;
}

// Calendar Types
export interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  created_by: Author;
  start_datetime: string;
  end_datetime: string;
  location: string;
  is_all_day: boolean;
  is_own: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEventData {
  title: string;
  description?: string;
  start_datetime: string;
  end_datetime: string;
  location?: string;
  is_all_day?: boolean;
}

export interface UpdateEventData extends Partial<CreateEventData> {}

// Messaging Types
export interface Participant {
  id: number;
  first_name: string;
  last_name: string;
  profile_picture: string | null;
}

export interface Message {
  id: number;
  conversation: number;
  sender: Participant;
  content: string;
  is_own: boolean;
  is_read: boolean;
  created_at: string;
}

export interface LastMessage {
  id: number;
  content: string;
  sender_id: number;
  created_at: string;
}

export interface Conversation {
  id: number;
  participants: Participant[];
  other_participants: Participant[];
  last_message: LastMessage | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface CreateConversationData {
  participant_ids: number[];
  initial_message?: string;
}

// WebSocket message types
export interface WsNewMessage {
  type: 'new_message';
  message: Message;
}

export interface WsMessagesRead {
  type: 'messages_read';
  conversation_id: number;
  reader_id: number;
}

export interface WsTyping {
  type: 'typing';
  conversation_id: number;
  user_id: number;
  user_name: string;
}

export interface WsNewConversation {
  type: 'new_conversation';
  conversation: Conversation;
}

export interface WsNewNotification {
  type: 'new_notification';
  notification: Notification;
}

export type WsMessage = WsNewMessage | WsMessagesRead | WsTyping | WsNewConversation | WsNewNotification;

// Notification Types
export type NotificationType =
  | 'new_message'
  | 'new_announcement'
  | 'new_thread'
  | 'thread_reply'
  | 'post_reply'
  | 'event_reminder'
  | 'food_ticket';

export interface RelatedUser {
  id: number;
  first_name: string;
  last_name: string;
  profile_picture: string | null;
}

export interface Notification {
  id: number;
  notification_type: NotificationType;
  notification_type_display: string;
  title: string;
  message: string;
  link: string;
  is_read: boolean;
  related_user: RelatedUser | null;
  created_at: string;
}

export interface NotificationPreference {
  id: number;
  // In-app preferences
  notify_messages: boolean;
  notify_announcements: boolean;
  notify_forum_subscriptions: boolean;
  notify_thread_replies: boolean;
  notify_event_reminders: boolean;
  notify_food_tickets: boolean;
  // Email preferences
  email_messages: boolean;
  email_announcements: boolean;
  email_forum_subscriptions: boolean;
  email_thread_replies: boolean;
  email_event_reminders: boolean;
  email_food_tickets: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateNotificationPreferenceData {
  notify_messages?: boolean;
  notify_announcements?: boolean;
  notify_forum_subscriptions?: boolean;
  notify_thread_replies?: boolean;
  notify_event_reminders?: boolean;
  notify_food_tickets?: boolean;
  email_messages?: boolean;
  email_announcements?: boolean;
  email_forum_subscriptions?: boolean;
  email_thread_replies?: boolean;
  email_event_reminders?: boolean;
  email_food_tickets?: boolean;
}

// Food Team Types
export interface TeamMemberUser {
  id: number;
  first_name: string;
  last_name: string;
  profile_picture: string | null;
}

export interface FoodTeamMember {
  id: number;
  user: TeamMemberUser;
  house_number: string;
  is_own: boolean;
  created_at: string;
}

export interface FoodTeam {
  id: number;
  date: string;
  day_name: string;
  notes: string;
  members: FoodTeamMember[];
  member_count: number;
  is_my_team: boolean;
  created_at: string;
  updated_at: string;
}

export interface FoodTeamListItem {
  id: number;
  date: string;
  day_name: string;
  member_count: number;
  is_my_team: boolean;
  members_display: string;
}

export interface SwapRequestMembership {
  id: number;
  user: TeamMemberUser;
  house_number: string;
  team_date: string;
  team_day_name: string;
}

export type SwapRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TeamSwapRequest {
  id: number;
  requester: TeamMemberUser;
  requester_membership: SwapRequestMembership;
  target_membership: SwapRequestMembership;
  status: SwapRequestStatus;
  message: string;
  response_message: string;
  is_incoming: boolean;
  is_outgoing: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSwapRequestData {
  requester_membership_id: number;
  target_membership_id: number;
  message?: string;
}

export interface RespondSwapRequestData {
  action: 'accept' | 'decline';
  response_message?: string;
}

// Food Team Cycle Types
export type CycleStatus = 'draft' | 'collecting_wishes' | 'generating' | 'finalized';

export interface FoodTeamCycle {
  id: number;
  name: string;
  cooking_dates: string[];
  wish_deadline: string;
  status: CycleStatus;
  is_accepting_wishes: boolean;
  team_count: number;
  wish_count: number;
  my_wish_submitted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCycleData {
  name: string;
  cooking_dates: string[];
  wish_deadline: string;
}

export interface FoodTeamWish {
  id: number;
  cycle: number;
  user: number;
  user_name: string;
  available_dates: string[];
  available_date_count: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface CreateWishData {
  available_dates: string[];
  comment?: string;
}

export interface TeamGenerationResult {
  success: boolean;
  message: string;
  teams_created: number;
  unassigned_persons: string[];
  warnings: string[];
}
