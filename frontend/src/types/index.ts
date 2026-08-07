/**
 * Type definitions for KB Intra
 */

export interface User {
  id: number

  email: string

  first_name: string

  last_name: string

  phone_number: string

  birthdate: string | null

  profile_picture: string | null

  bio: string

  house: number | null

  house_name: string | null

  house_slug: string | null

  house_inhabitant_count: number

  is_staff: boolean

  is_food_admin: boolean

  is_economy_admin: boolean

  date_joined: string

  accessibility_mode: boolean

  rainbow_mode: boolean

  hide_closed_threads: boolean

  // Private bank details for prefilling udlæg. Only returned for the current
  // user (GET /users/me/), never in the shared user list/detail.
  bank_reg_nr?: string

  bank_account_number?: string
}

export interface Child {
  id: number

  name: string

  birthdate: string | null

  profile_picture: string | null

  created_at: string
}

export interface Car {
  id: number

  license_plate: string

  is_electric: boolean

  display_name: string

  // Bildeling
  is_shared: boolean

  rate_per_km: string | null

  make: string

  model_name: string

  color: string

  year: number | null

  seats: number | null

  has_tow_hitch: boolean

  has_isofix: boolean

  dogs_allowed: boolean

  has_charge_fob: boolean

  equipment_note: string

  practical_note: string

  /** Which terms version this household accepted as a lender; "" if never. */
  terms_accepted_version: string

  /** Whether that acceptance covers the terms currently in force. */
  has_accepted_current_terms: boolean

  created_at: string
}

export interface CarBlock {
  id: number

  car: number

  days_of_week: number[]

  days_of_week_display: string

  start_time: string

  end_time: string
}

/** Why a shared car may look busy. Only "loan" actually blocks selection. */
export type CarConflict = "requested" | "schedule" | "loan" | null

export interface SharedCar {
  id: number

  display_name: string

  license_plate: string

  house_name: string

  house_slug: string

  is_electric: boolean

  make: string

  model_name: string

  color: string

  year: number | null

  seats: number | null

  has_tow_hitch: boolean

  has_isofix: boolean

  dogs_allowed: boolean

  has_charge_fob: boolean

  equipment_note: string

  /** No practical_note here on purpose: the borrow list is browsable by every
   * resident, and that field says where the key and the charge fob are kept. It
   * arrives as CarLoan.car_practical_note once an owner has said yes. */
  effective_rate_per_km: string

  blocks: CarBlock[]

  conflict: CarConflict

  conflict_note: string

  meets_requirements: boolean

  selectable: boolean
}

export interface SharedCarsResponse {
  start: string

  end: string

  default_rate_per_km: string

  max_candidates: number

  /** Published so the client can warn before sending a window the server refuses. */
  max_loan_days: number

  cars: SharedCar[]
}

/** "declined" is terminal: every asked household said no, so nobody is coming. */
export type CarLoanStatus = "requested" | "active" | "completed" | "cancelled" | "declined"

/**
 * What the signed-in viewer is to a loan, decided by the server.
 *
 * One loan is visible to the borrower and to every asked household, so the UI
 * must not infer this from `is_borrower` + `status`: that inference is what once
 * showed nine uninvolved households a cancel button and another household's key.
 */
export type LoanViewerRole = "borrower" | "lender" | "asked" | "declined" | "closed_out" | "none"

export type CarLoanCandidateStatus = "asked" | "accepted" | "declined" | "closed"

export interface CarLoanCandidate {
  id: number

  car: number

  car_display_name: string

  car_house_name: string

  status: CarLoanCandidateStatus

  responded_by_name: string

  responded_at: string | null

  /** Whether the signed-in user's household owns this car and may answer for it. */
  is_own_household: boolean
}

export interface CarLoan {
  id: number

  borrower: number

  borrower_name: string

  is_borrower: boolean

  viewer_role: LoanViewerRole

  /** Whether the server would allow this viewer to cancel right now. */
  can_cancel: boolean

  /** Whether the borrowed window has begun, per the server's clock. */
  has_started: boolean

  status: CarLoanStatus

  start_at: string

  end_at: string

  expected_km: number

  needs_isofix: boolean

  needs_tow_hitch: boolean

  min_seats: number | null

  note: string

  terms_version: string

  /** The lending household's accepted version, snapshotted when the loan began. */
  owner_terms_version: string

  car: number | null

  car_display_name: string

  car_house_name: string

  /** Empty unless you are the borrower or the lending household. */
  car_practical_note: string

  rate_per_km: string | null

  activated_at: string | null

  /** The settlement is withheld from households not party to the loan. */
  actual_km: number | null

  expense_amount: string | null

  expense_note: string

  damage_note: string

  amount_due: string | null

  completed_at: string | null

  candidates: CarLoanCandidate[]

  created_at: string
}

/** One point. `lead` is the bold label a point may open with, else empty. */
export interface LoanTermsBullet {
  lead: string

  text: string
}

/**
 * A paragraph or a run of points, in the order the terms file has them. The
 * server does the splitting so the client never parses Markdown.
 */
export interface LoanTermsBlock {
  kind: "paragraph" | "bullets"

  text?: string

  items?: LoanTermsBullet[]
}

export interface LoanTermsSection {
  heading: string

  blocks: LoanTermsBlock[]
}

export interface CarSharingTerms {
  version: string

  title: string

  /** The numbered sections of the agreement, already split by the server. */
  sections: LoanTermsSection[]

  text: string

  default_rate_per_km: string

  /** Whether this resident has already accepted the version in force as a
   *  borrower. Consent is asked for once per version, not once per loan. */
  accepted: boolean

  /** The version they did accept; "" if never. */
  accepted_version: string

  accepted_at: string | null
}

export interface House {
  id: number

  slug: string

  name: string

  description: string

  address: string

  profile_picture: string | null

  inhabitant_count: number

  inhabitants?: UserSummary[]

  children?: Child[]

  cars?: Car[]

  created_at: string
}

export interface UserSummary {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null

  bio: string

  phone_number?: string

  email?: string
}

export interface Invitation {
  id: number

  email: string

  token: string

  house: number

  house_name: string

  created_by: number

  created_by_name: string

  created_at: string

  used_at: string | null

  expires_at: string

  is_valid: boolean
}

export interface AuthTokens {
  access: string

  refresh: string
}

export interface LoginCredentials {
  email: string

  password: string
}

export interface RegisterData {
  token: string

  email: string

  password: string

  password_confirm: string

  first_name: string

  last_name: string
}

export interface ChangePasswordData {
  current_password: string

  new_password: string

  new_password_confirm: string
}

export interface ForgotPasswordData {
  email: string
}

export interface ResetPasswordData {
  token: string

  new_password: string

  new_password_confirm: string
}

export interface PaginatedResponse<T> {
  count: number

  next: string | null

  previous: string | null

  results: T[]
}

// Forum Types

export interface Author {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null

  phone_number?: string
}

export interface SubgroupMember {
  id: number

  user: Author

  role: string

  house_name: string

  created_at: string
}

export interface Subgroup {
  id: number

  name: string

  description: string

  links_info: string

  links_info_members: string

  slug: string

  is_default: boolean

  is_committee: boolean

  is_main: boolean

  icon: string

  thread_count: number

  unread_thread_count: number

  is_subscribed: boolean

  latest_thread_title: string | null

  latest_thread_activity_at: string | null

  created_at: string

  // No `last_activity_at`: the API deliberately doesn't expose it, because it is
  // bumped by private threads too. Sort on latest_thread_activity_at instead.

  allows_members: boolean

  default_members_only: boolean

  is_member: boolean

  members: SubgroupMember[]

  subscriber_count: number
}

export interface SubgroupSubscriber {
  id: number

  user: Author

  house_name: string

  created_at: string
}

export interface SubgroupSubscription {
  id: number

  subgroup: Subgroup

  notify_new_threads: boolean

  created_at: string
}

export interface PostAttachment {
  id: number

  name: string

  file: string

  file_url: string

  thumbnail_url: string

  preview_url?: string

  preview_html?: string

  uploaded_by: Author | null

  uploaded_at: string
}

export interface GalleryItem {
  id: number

  name: string

  file_url: string

  thumbnail_url: string

  preview_url?: string

  preview_html?: string

  uploaded_at: string

  uploaded_by: Author | null

  post_id: number

  thread_id: number

  thread_slug: string

  thread_title: string

  thread_members_only: boolean

  subgroup_slug: string
}

export type ReactionType = string

export interface ReactionUser {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface ReactionSummary {
  reaction_type: ReactionType

  emoji: string

  count: number

  has_reacted: boolean

  users: ReactionUser[]
}

export interface ReactionTypeInfo {
  type: string

  emoji: string
}

export interface PollOption {
  id: number

  text: string

  order: number

  vote_count: number

  has_voted: boolean

  voters: Author[]
}

export interface Poll {
  id: number

  question: string

  allow_multiple_votes: boolean

  is_anonymous: boolean

  allow_others_to_add_options: boolean

  options: PollOption[]

  total_voters: number

  is_own: boolean

  created_at: string
}

export interface PollOptionData {
  id?: number

  text: string
}

export interface CreatePollData {
  question: string

  allow_multiple_votes: boolean

  is_anonymous: boolean

  allow_others_to_add_options: boolean

  options: PollOptionData[]
}

export interface Post {
  id: number

  thread: number

  author: Author | null

  edited_by: Author | null

  content: string

  is_own: boolean

  can_edit: boolean

  attachments: PostAttachment[]

  reactions: ReactionSummary[]

  poll: Poll | null

  created_at: string

  updated_at: string
}

export interface Thread {
  id: number

  subgroup: number

  title: string

  slug: string

  author: Author | null

  is_pinned: boolean

  is_closed: boolean

  members_only: boolean

  post_count: number

  last_post_at: string | null

  last_post_author: Author | null

  is_unread: boolean

  created_at: string

  updated_at: string
}

export interface ThreadDetail extends Thread {
  subgroup_name: string

  subgroup_slug: string

  is_own: boolean

  can_edit: boolean

  can_close: boolean

  can_toggle_privacy: boolean

  is_muted: boolean

  event_id: number | null

  event_slug: string | null

  posts: Post[]
}

export interface CreateThreadData {
  title: string

  content: string

  members_only?: boolean
}

export interface CreatePostData {
  content: string
}

export interface RecentActivity {
  id: number

  author: Author | null

  content: string

  thread_id: number

  thread_title: string

  thread_slug: string

  subgroup_slug: string

  subgroup_name: string

  members_only: boolean

  created_at: string
}

export interface Folder {
  id: number

  name: string

  slug: string

  parent: number | null

  file_count: number

  subfolder_count: number

  created_at: string
}

export interface ForumFile {
  id: number

  name: string

  file: string

  file_url: string

  /** JPEG rendition for formats browsers can't decode (HEIC/HEIF), when the
   *  source model has one. Forum documents don't, so it may be absent. */
  preview_url?: string

  preview_html?: string

  uploaded_by: Author | null

  is_own: boolean

  can_toggle_privacy?: boolean

  uploaded_at: string

  members_only: boolean
}

// Announcement Types

export interface AnnouncementAttachment {
  id: number

  name: string

  file: string

  file_url: string

  preview_url?: string

  preview_html?: string

  uploaded_by: Author | null

  uploaded_at: string
}

export interface Announcement {
  id: number

  title: string

  content: string

  author: Author

  edited_by: Author | null

  is_active: boolean

  show_on_dashboard: boolean

  priority: number

  is_own: boolean

  can_edit: boolean

  can_toggle_dashboard: boolean

  attachments: AnnouncementAttachment[]

  created_at: string

  updated_at: string
}

export interface CreateAnnouncementData {
  title: string

  content: string

  is_active?: boolean

  show_on_dashboard?: boolean

  priority?: number
}

// Food Types

export type DiningOption = "eat_in" | "take_away"

export type SeatingTime = "17:30" | "18:30"

export interface MealPreference {
  id: number

  day_of_week: number

  day_name: string

  adults_meat: number

  adults_veg: number

  children_count: number

  dining_option: DiningOption

  seating_time: SeatingTime
}

export interface CreateMealPreferenceData {
  day_of_week: number

  adults_meat: number

  adults_veg: number

  children_count: number

  dining_option: DiningOption

  seating_time: SeatingTime
}

export interface HouseSimple {
  id: number

  name: string
}

export interface AvailablePortions {
  adults_meat: number

  adults_veg: number

  children_count: number
}

export interface MealRegistration {
  id: number | null

  date: string

  day_of_week: number

  day_name: string

  adults_meat: number

  adults_veg: number

  children_count: number

  dining_option: DiningOption

  seating_time: SeatingTime

  house: HouseSimple

  is_active: boolean

  total_portions: number

  is_locked: boolean

  is_from_preference?: boolean

  available_portions: AvailablePortions

  created_at: string | null

  updated_at: string | null
}

export interface CreateMealRegistrationData {
  date: string

  adults_meat: number

  adults_veg: number

  children_count: number

  dining_option: DiningOption

  seating_time: SeatingTime

  is_active?: boolean
}

export interface RegistrationCount {
  adults: number

  adults_meat: number

  adults_veg: number

  children: number
}

export type TotalRegistrationCount = RegistrationCount

export interface DailyRegistrationStats {
  date: string

  takeaway: RegistrationCount

  eat_in_1730: RegistrationCount

  eat_in_1830: RegistrationCount

  // Gross registration totals. Tickets never reduce these.
  total_registrations: TotalRegistrationCount
}

// Backend returns this shape (instead of DailyRegistrationStats) for dates

// that are in ClosedFoodDay. See backend/apps/food/views.py.

export interface ClosedDayStats {
  closed: true

  reason: string
}

export interface WeeklyRegistrationStats {
  [date: string]: DailyRegistrationStats | ClosedDayStats
}

export function isClosedDayStats(
  stats: DailyRegistrationStats | ClosedDayStats | undefined,
): stats is ClosedDayStats {
  return !!stats && "closed" in stats && stats.closed === true
}

export interface TicketOwner extends Author {
  phone_number: string
}

export interface FoodTicket {
  id: number

  owner: TicketOwner

  date: string

  day_of_week: number

  day_name: string

  adults_meat: number

  adults_veg: number

  children_count: number

  price: string | null

  is_free: boolean

  description: string

  is_available: boolean

  claimed_by: TicketOwner | null

  claimed_at: string | null

  total_portions: number

  is_own: boolean

  created_at: string
}

export interface CreateFoodTicketData {
  date: string

  adults_meat: number

  adults_veg: number

  children_count: number

  price?: number | null

  description?: string
}

export interface ClaimFoodTicketData {
  adults_meat?: number

  adults_veg?: number

  children_count?: number
}

// Drive Menu Types (from Google Drive)

export interface DriveMenu {
  id: number

  week_number: number

  year: number

  week_start_date: string

  monday_menu: string

  tuesday_menu: string

  wednesday_menu: string

  thursday_menu: string

  fetched_at: string

  is_stale: boolean

  drive_folder_url: string
}

export interface ClosedFoodDay {
  id: number

  date: string

  day_name: string

  reason: string

  created_at: string
}

/** A set of portion prices that applies from `effective_from` (inclusive). */
export interface MealPrice {
  id: number

  effective_from: string

  price_adult_meat: number

  price_adult_veg: number

  price_child: number

  note: string

  created_by_name: string

  created_at: string

  /** True once the set has taken effect — it can no longer be edited or deleted. */
  is_locked: boolean
}

/** The three portion prices in effect for a given meal date. */
export interface MealPrices {
  adultMeat: number

  adultVeg: number

  child: number
}

export interface CreateMealPriceData {
  effective_from: string

  price_adult_meat: number

  price_adult_veg: number

  price_child: number

  note?: string
}

export interface ClosedDayPlaceholder {
  id: null

  date: string

  day_of_week: number

  day_name: string

  is_closed: true

  closed_reason: string
}

export function isClosedDayPlaceholder(
  r: MealRegistration | ClosedDayPlaceholder,
): r is ClosedDayPlaceholder {
  return "is_closed" in r && r.is_closed === true
}

// Event Types (unified: community events + private room bookings)

export type EventVisibility = "community" | "private"

export interface RoomInfo {
  id: number

  name: string

  color: string
}

export interface SubgroupInfo {
  id: number

  name: string

  slug: string
}

export interface FolderInfo {
  id: number

  name: string
}

export interface EventAttendance {
  id: number

  user: Author | null

  child_id: number | null

  child_name: string | null

  status: "attending" | "not_attending" | "not_answered"

  updated_at: string
}

export interface RsvpSummary {
  attending: number

  not_attending: number

  not_answered: number
}

export interface Event {
  id: number

  slug: string

  title: string

  description: string

  created_by: Author

  edited_by: Author | null

  visibility: EventVisibility

  start_datetime: string

  end_datetime: string

  rooms: RoomInfo[]

  location: string

  resolved_location: string

  subgroup: SubgroupInfo | null

  folder: FolderInfo | null

  rsvp_enabled: boolean

  rsvp_deadline: string | null

  rsvp_summary: RsvpSummary | null

  my_rsvp: string | null

  household_rsvps: EventAttendance[] | null

  is_own: boolean

  can_edit: boolean

  is_cancelled: boolean

  cancellation_message: string

  thread_id: number | null

  thread_subgroup_slug: string | null

  thread_slug: string | null

  created_at: string

  updated_at: string
}

export interface CreateEventData {
  title: string

  description?: string

  visibility?: EventVisibility

  start_datetime: string

  end_datetime: string

  room_ids?: number[]

  location?: string

  subgroup_id?: number | null

  rsvp_enabled?: boolean

  rsvp_deadline?: string | null
}

export interface UpdateEventData extends Partial<CreateEventData> {}

export interface HouseholdMember {
  type: "adult" | "child"

  id: number

  name: string

  current_status: string | null
}

export interface RsvpItem {
  user_id?: number

  child_id?: number

  status: "attending" | "not_attending" | "not_answered"
}

export interface RsvpSubmitData {
  attendances: RsvpItem[]
}

export interface EventFile {
  id: number

  name: string

  file_url: string

  uploaded_by: Author

  uploaded_at: string
}

// Messaging Types

export interface Participant {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface MessageAttachment {
  id: number

  name: string

  file: string

  file_url: string

  preview_url?: string

  preview_html?: string

  uploaded_at: string
}

export interface MessageReactionUser {
  id: number

  first_name: string

  last_name: string
}

export interface MessageReactionSummary {
  reaction_type: ReactionType

  emoji: string

  count: number

  has_reacted: boolean

  users: MessageReactionUser[]
}

export interface WsMessageReactionEntry {
  reaction_type: string

  emoji: string

  count: number

  user_ids: number[]

  users: MessageReactionUser[]
}

export interface Message {
  id: number

  conversation: number

  sender: Participant

  content: string

  is_own: boolean

  is_read: boolean

  is_system_message: boolean

  is_deleted: boolean

  edited_at: string | null

  created_at: string

  attachments: MessageAttachment[]

  reactions?: MessageReactionSummary[]
}

export interface LastMessage {
  id: number

  content: string

  sender_id: number

  created_at: string
}

export interface Conversation {
  id: number

  name: string

  participants: Participant[]

  other_participants: Participant[]

  last_message: LastMessage | null

  unread_count: number

  created_at: string

  updated_at: string
}

export interface ConversationDetail extends Conversation {
  messages: Message[]
}

export interface CreateConversationData {
  participant_ids: number[]

  initial_message?: string

  attachments?: File[]
}

// WebSocket message types

export interface WsNewMessage {
  type: "new_message"

  message: Message
}

export interface WsMessagesRead {
  type: "messages_read"

  conversation_id: number

  reader_id: number
}

export interface WsTyping {
  type: "typing"

  conversation_id: number

  user_id: number

  user_name: string
}

export interface WsNewConversation {
  type: "new_conversation"

  conversation: Conversation
}

export interface WsNewNotification {
  type: "new_notification"

  notification: Notification
}

export interface WsCarSharingUpdate {
  type: "car_sharing_update"
}

export interface WsMessageEdited {
  type: "message_edited"

  message_id: number

  conversation_id: number

  content: string

  edited_at: string
}

export interface WsMessageDeleted {
  type: "message_deleted"

  message_id: number

  conversation_id: number
}

export interface WsMessageReacted {
  type: "message_reacted"

  message_id: number

  conversation_id: number

  reactions: WsMessageReactionEntry[]
}

export interface WsConversationRenamed {
  type: "conversation_renamed"

  conversation_id: number

  name: string
}

export type WsMessage = WsNewMessage | WsMessagesRead | WsTyping | WsNewConversation | WsNewNotification | WsCarSharingUpdate | WsMessageEdited | WsMessageDeleted | WsMessageReacted | WsConversationRenamed

// Notification Types

export type NotificationType = "new_message" | "new_announcement" | "new_thread" | "thread_reply" | "post_reply" | "post_reaction" | "event_created" | "event_updated" | "event_cancelled" | "event_reminder" | "food_ticket" | "mention" | "post_edited_by_admin" | "event_edited_by_admin" | "announcement_edited_by_admin" | "expense_processed" | "car_loan_request" | "car_loan_update"

export interface MentionUser {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface RelatedUser {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface Notification {
  id: number

  notification_type: NotificationType

  notification_type_display: string

  title: string

  message: string

  link: string

  is_read: boolean

  aggregate_count: number

  related_user: RelatedUser | null

  created_at: string

  updated_at: string
}

export interface NotificationPreference {
  id: number

  // In-app preferences

  notify_message_reactions: boolean

  notify_announcements: boolean

  notify_announcement_updates: boolean

  notify_forum_subscriptions: boolean

  notify_thread_replies: boolean

  notify_subgroup_activity: boolean

  notify_post_reactions: boolean

  notify_events: boolean

  notify_event_reminders: boolean

  notify_food_tickets: boolean

  notify_mentions: boolean

  notify_car_sharing: boolean

  // Email preferences

  email_messages: boolean

  email_announcements: boolean

  email_announcement_updates: boolean

  email_forum_subscriptions: boolean

  email_thread_replies: boolean

  email_subgroup_activity: boolean

  email_post_reactions: boolean

  email_events: boolean

  email_event_reminders: boolean

  email_food_tickets: boolean

  email_mentions: boolean

  email_car_sharing: boolean

  // Push preferences

  push_messages: boolean

  push_announcements: boolean

  push_announcement_updates: boolean

  push_forum_subscriptions: boolean

  push_thread_replies: boolean

  push_subgroup_activity: boolean

  push_post_reactions: boolean

  push_events: boolean

  push_event_reminders: boolean

  push_food_tickets: boolean

  push_mentions: boolean

  push_car_sharing: boolean

  created_at: string

  updated_at: string
}

export interface UpdateNotificationPreferenceData {
  notify_message_reactions?: boolean

  notify_announcements?: boolean

  notify_announcement_updates?: boolean

  notify_forum_subscriptions?: boolean

  notify_thread_replies?: boolean

  notify_subgroup_activity?: boolean

  notify_post_reactions?: boolean

  notify_events?: boolean

  notify_event_reminders?: boolean

  notify_food_tickets?: boolean

  notify_mentions?: boolean

  notify_car_sharing?: boolean

  email_messages?: boolean

  email_announcements?: boolean

  email_announcement_updates?: boolean

  email_forum_subscriptions?: boolean

  email_thread_replies?: boolean

  email_subgroup_activity?: boolean

  email_post_reactions?: boolean

  email_events?: boolean

  email_event_reminders?: boolean

  email_food_tickets?: boolean

  email_mentions?: boolean

  email_car_sharing?: boolean

  push_messages?: boolean

  push_announcements?: boolean

  push_announcement_updates?: boolean

  push_forum_subscriptions?: boolean

  push_thread_replies?: boolean

  push_subgroup_activity?: boolean

  push_post_reactions?: boolean

  push_events?: boolean

  push_event_reminders?: boolean

  push_food_tickets?: boolean

  push_mentions?: boolean

  push_car_sharing?: boolean
}

// Food Team Types

export interface TeamMemberUser {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface FoodTeamMember {
  id: number

  user: TeamMemberUser

  house_number: string

  is_own: boolean

  created_at: string
}

export interface FoodTeam {
  id: number

  date: string

  day_name: string

  notes: string

  members: FoodTeamMember[]

  member_count: number

  is_my_team: boolean

  created_at: string

  updated_at: string
}

export interface FoodTeamListItem {
  id: number

  date: string

  day_name: string

  member_count: number

  is_my_team: boolean

  members_display: string
}

export interface SwapRequestMembership {
  id: number

  user: TeamMemberUser

  house_number: string

  team_date: string

  team_day_name: string
}

export type SwapRequestStatus = "pending" | "accepted" | "declined" | "cancelled"

export interface TeamSwapRequest {
  id: number

  requester: TeamMemberUser

  requester_membership: SwapRequestMembership

  target_membership: SwapRequestMembership

  status: SwapRequestStatus

  message: string

  response_message: string

  is_incoming: boolean

  is_outgoing: boolean

  created_at: string

  updated_at: string
}

export interface CreateSwapRequestData {
  requester_membership_id: number

  target_membership_id: number

  message?: string
}

export interface RespondSwapRequestData {
  action: "accept" | "decline"

  response_message?: string
}

// Food Team Cycle Types

export type CycleStatus = "draft" | "collecting_wishes" | "generating" | "finalized"

export interface FoodTeamCycle {
  id: number

  name: string

  cooking_dates: string[]

  wish_deadline: string

  status: CycleStatus

  is_accepting_wishes: boolean

  team_count: number

  wish_count: number

  my_wish_submitted: boolean

  created_at: string

  updated_at: string
}

export interface CreateCycleData {
  name: string

  cooking_dates: string[]

  wish_deadline: string
}

export interface FoodTeamWish {
  id: number

  cycle: number

  user: number

  user_name: string

  available_dates: string[]

  available_date_count: number

  comment: string

  created_at: string

  updated_at: string
}

export interface CreateWishData {
  available_dates: string[]

  comment?: string
}

export interface TeamGenerationResult {
  success: boolean

  message: string

  teams_created: number

  unassigned_persons: string[]

  warnings: string[]
}

// Booking Types

export interface Room {
  id: number

  name: string

  description: string

  image: string | null

  color: string

  is_active: boolean

  sort_order: number

  created_at: string

  updated_at: string
}

export interface BookingRoom {
  id: number

  name: string

  color: string
}

export interface BookingUser {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface RecurringBooking {
  id: number

  room: BookingRoom

  created_by: BookingUser

  title: string

  description: string

  days_of_week: number[]

  days_of_week_display: string

  start_time: string

  end_time: string

  effective_from: string | null

  effective_until: string | null

  is_active: boolean

  created_at: string

  updated_at: string
}

export interface CreateRecurringBookingData {
  room_id: number

  title: string

  description?: string

  days_of_week: number[]

  start_time: string

  end_time: string

  effective_from?: string | null

  effective_until?: string | null

  is_active?: boolean
}

export interface CalendarBooking {
  id: string

  event_slug: string | null

  room: BookingRoom

  user: BookingUser

  title: string

  description: string

  start_datetime: string

  end_datetime: string

  is_recurring: boolean

  recurring_booking_id: number | null

  is_own: boolean
}

export interface AvailabilityCheckRequest {
  room_ids: number[]

  start_datetime: string

  end_datetime: string

  exclude_event_id?: number
}

export interface AvailabilityResult {
  can_book_all: boolean

  available_rooms: number[]

  conflicts_by_room: Record<number, string[]>
}

// Udlæg (expense reimbursements)

export type ExpenseStatus = "pending" | "paid" | "rejected"

export interface ExpenseAttachment {
  id: number

  name: string

  download_url: string
}

export interface ExpenseSubmitter {
  id: number

  first_name: string

  last_name: string

  profile_picture: string | null
}

export interface Expense {
  id: number

  submitted_by: ExpenseSubmitter | null

  reg_nr: string

  account_number: string

  amount: string

  description: string

  approval_reference: string

  food_related: boolean

  status: ExpenseStatus

  status_display: string

  admin_note: string

  paid_at: string | null

  created_at: string

  updated_at: string

  attachments: ExpenseAttachment[]
}

export interface AdminExpenseList {
  results: Expense[]

  total: string

  count: number

  page: number

  num_pages: number
}
