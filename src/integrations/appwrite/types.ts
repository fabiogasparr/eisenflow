// ============================================================================
// GERADO AUTOMATICAMENTE por appwrite/gen-types.mjs — não edite à mão.
// Fonte da verdade: appwrite/schema.mjs
// ============================================================================

import type { Models } from 'appwrite';

// O ID do database vem do ambiente; o padrão é o database real do projeto.
// NÃO troque por um nome legível: o Appwrite gerou este ID e é ele que o servidor conhece.
export const DATABASE_ID = (import.meta.env.VITE_APPWRITE_DATABASE_ID as string) || '6a9887fe000ab0ab3b2e';

/** IDs das collections — use sempre a constante, nunca a string solta. */
export const COLLECTIONS = {
  profiles: 'profiles',
  user_roles: 'user_roles',
  user_preferences: 'user_preferences',
  tenants: 'tenants',
  tenant_members: 'tenant_members',
  tenant_invites: 'tenant_invites',
  teams: 'teams',
  team_members: 'team_members',
  team_invites: 'team_invites',
  projects: 'projects',
  tasks: 'tasks',
  subtasks: 'subtasks',
  delegations: 'delegations',
  task_shares: 'task_shares',
  task_attachments: 'task_attachments',
  task_focus_sessions: 'task_focus_sessions',
  task_reclassification_suggestions: 'task_reclassification_suggestions',
  task_reminders: 'task_reminders',
  scheduled_reminders: 'scheduled_reminders',
  recurring_schedules: 'recurring_schedules',
  user_reminder_preferences: 'user_reminder_preferences',
  notifications: 'notifications',
  productivity_metrics: 'productivity_metrics',
  gamification: 'gamification',
  user_badges: 'user_badges',
  google_calendar_tokens: 'google_calendar_tokens',
  google_token_audit_log: 'google_token_audit_log',
  whatsapp_connections: 'whatsapp_connections',
  tenant_whatsapp_connections: 'tenant_whatsapp_connections',
  tenant_member_phones: 'tenant_member_phones',
  whatsapp_chat_history: 'whatsapp_chat_history',
  whatsapp_processed_messages: 'whatsapp_processed_messages',
  whatsapp_sent_reminders: 'whatsapp_sent_reminders',
  tenant_mcp_settings: 'tenant_mcp_settings',
  tenant_api_keys: 'tenant_api_keys',
  tenant_api_audit_log: 'tenant_api_audit_log',
  ip_whitelist: 'ip_whitelist',
  ip_access_log: 'ip_access_log',
  suspicious_ips: 'suspicious_ips',
  rate_limit_buckets: 'rate_limit_buckets',
  rate_limit_events: 'rate_limit_events',
} as const;
export type CollectionId = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** IDs dos buckets do Storage. */
export const BUCKETS = {
  'task-attachments': 'task-attachments',
  'chat-attachments': 'chat-attachments',
  'tenant-logos': 'tenant-logos',
  'avatars': 'avatars',
} as const;

// ---------------------------------------------------------------- enums
export type AppRole = 'admin' | 'member' | 'super_admin';
export const APP_ROLE_VALUES = ['admin', 'member', 'super_admin'] as const;
export type DelegationStatus = 'pending' | 'accepted' | 'completed' | 'rejected';
export const DELEGATION_STATUS_VALUES = ['pending', 'accepted', 'completed', 'rejected'] as const;
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';
export const INVITE_STATUS_VALUES = ['pending', 'accepted', 'expired', 'cancelled'] as const;
export type ReclassificationStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export const RECLASSIFICATION_STATUS_VALUES = ['pending', 'accepted', 'rejected', 'expired'] as const;
export type ReminderChannel = 'in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email';
export const REMINDER_CHANNEL_VALUES = ['in_app', 'browser', 'whatsapp_personal', 'whatsapp_tenant', 'email'] as const;
export type ReminderKind = 'due_d1' | 'due_1h' | 'due_now' | 'start_now' | 'start_5min' | 'custom' | 'daily_summary' | 'weekly_plan';
export const REMINDER_KIND_VALUES = ['due_d1', 'due_1h', 'due_now', 'start_now', 'start_5min', 'custom', 'daily_summary', 'weekly_plan'] as const;
export type ReminderRecipient = 'creator' | 'assignee' | 'shared';
export const REMINDER_RECIPIENT_VALUES = ['creator', 'assignee', 'shared'] as const;
export type ScheduledReminderStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled';
export const SCHEDULED_REMINDER_STATUS_VALUES = ['pending', 'sent', 'failed', 'skipped', 'cancelled'] as const;
export type SharePermission = 'view' | 'edit';
export const SHARE_PERMISSION_VALUES = ['view', 'edit'] as const;
export type TaskQuadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';
export const TASK_QUADRANT_VALUES = ['do', 'schedule', 'delegate', 'eliminate'] as const;
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'eliminated';
export const TASK_STATUS_VALUES = ['pending', 'in_progress', 'completed', 'eliminated'] as const;
export type TeamRole = 'admin' | 'manager' | 'member';
export const TEAM_ROLE_VALUES = ['admin', 'manager', 'member'] as const;
export type TenantRole = 'owner' | 'admin' | 'member' | 'guest';
export const TENANT_ROLE_VALUES = ['owner', 'admin', 'member', 'guest'] as const;
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';
export const THREAT_LEVEL_VALUES = ['low', 'medium', 'high', 'critical'] as const;
export type RateLimitStatus = 'allowed' | 'blocked' | 'warning';
export const RATE_LIMIT_STATUS_VALUES = ['allowed', 'blocked', 'warning'] as const;

// ------------------------------------------------------- documentos
/** Perfil público do usuário. user_id = $id da conta Appwrite. */
export interface Profiles extends Models.Document {
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  preferred_language?: string | null;
  disabled?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type ProfilesInput = Pick<Profiles, 'user_id'> & Partial<Pick<Profiles, 'display_name' | 'avatar_url' | 'preferred_language' | 'disabled' | 'created_at' | 'updated_at'>>;

/** Papéis globais. Em produção prefira labels do Appwrite; a collection existe para compatibilidade com useAdminGuard. */
export interface UserRoles extends Models.Document {
  user_id: string;
  role: 'admin' | 'member' | 'super_admin';
}
export type UserRolesInput = Pick<UserRoles, 'user_id' | 'role'>;

export interface UserPreferences extends Models.Document {
  user_id: string;
  timezone?: string | null;
  language?: string | null;
  date_format?: string | null;
  time_format?: string | null;
  week_starts_on?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type UserPreferencesInput = Pick<UserPreferences, 'user_id'> & Partial<Pick<UserPreferences, 'timezone' | 'language' | 'date_format' | 'time_format' | 'week_starts_on' | 'created_at' | 'updated_at'>>;

/** Espelha um Team nativo do Appwrite (appwrite_team_id) para controle de acesso. */
export interface Tenants extends Models.Document {
  name: string;
  slug: string;
  logo_url?: string | null;
  created_by: string;
  appwrite_team_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TenantsInput = Pick<Tenants, 'name' | 'slug' | 'created_by'> & Partial<Pick<Tenants, 'logo_url' | 'appwrite_team_id' | 'created_at' | 'updated_at'>>;

export interface TenantMembers extends Models.Document {
  tenant_id: string;
  user_id: string;
  role?: 'owner' | 'admin' | 'member' | 'guest' | null;
  joined_at?: string | null;
}
export type TenantMembersInput = Pick<TenantMembers, 'tenant_id' | 'user_id'> & Partial<Pick<TenantMembers, 'role' | 'joined_at'>>;

export interface TenantInvites extends Models.Document {
  tenant_id: string;
  invited_by: string;
  invited_email?: string | null;
  invite_code: string;
  status?: 'pending' | 'accepted' | 'expired' | 'cancelled' | null;
  role?: 'owner' | 'admin' | 'member' | 'guest' | null;
  created_at?: string | null;
  expires_at?: string | null;
}
export type TenantInvitesInput = Pick<TenantInvites, 'tenant_id' | 'invited_by' | 'invite_code'> & Partial<Pick<TenantInvites, 'invited_email' | 'status' | 'role' | 'created_at' | 'expires_at'>>;

/** Times internos de um tenant (não confundir com Teams nativos do Appwrite, usados para tenants). */
export interface Teams extends Models.Document {
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  created_by: string;
  tenant_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TeamsInput = Pick<Teams, 'name' | 'created_by'> & Partial<Pick<Teams, 'description' | 'avatar_url' | 'tenant_id' | 'created_at' | 'updated_at'>>;

export interface TeamMembers extends Models.Document {
  team_id: string;
  user_id: string;
  role?: 'admin' | 'manager' | 'member' | null;
  joined_at?: string | null;
}
export type TeamMembersInput = Pick<TeamMembers, 'team_id' | 'user_id'> & Partial<Pick<TeamMembers, 'role' | 'joined_at'>>;

export interface TeamInvites extends Models.Document {
  team_id: string;
  invited_by: string;
  invited_email?: string | null;
  invite_code: string;
  status?: 'pending' | 'accepted' | 'expired' | 'cancelled' | null;
  role?: 'admin' | 'manager' | 'member' | null;
  created_at?: string | null;
  expires_at?: string | null;
}
export type TeamInvitesInput = Pick<TeamInvites, 'team_id' | 'invited_by' | 'invite_code'> & Partial<Pick<TeamInvites, 'invited_email' | 'status' | 'role' | 'created_at' | 'expires_at'>>;

export interface Projects extends Models.Document {
  name: string;
  color?: string | null;
  owner_id: string;
  team_id?: string | null;
  tenant_id?: string | null;
  archived?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type ProjectsInput = Pick<Projects, 'name' | 'owner_id'> & Partial<Pick<Projects, 'color' | 'team_id' | 'tenant_id' | 'archived' | 'created_at' | 'updated_at'>>;

export interface Tasks extends Models.Document {
  title: string;
  description?: string | null;
  urgency?: number | null;
  importance?: number | null;
  quadrant?: 'do' | 'schedule' | 'delegate' | 'eliminate' | null;
  due_date?: string | null;
  estimated_time?: number | null;
  status?: 'pending' | 'in_progress' | 'completed' | 'eliminated' | null;
  project_id?: string | null;
  created_by: string;
  assigned_to?: string | null;
  tags?: string[] | null;
  impact_score?: number | null;
  position?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  recurrence_rule?: string | null;
  recurrence_parent_id?: string | null;
  google_event_id?: string | null;
  tenant_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TasksInput = Pick<Tasks, 'title' | 'created_by'> & Partial<Pick<Tasks, 'description' | 'urgency' | 'importance' | 'quadrant' | 'due_date' | 'estimated_time' | 'status' | 'project_id' | 'assigned_to' | 'tags' | 'impact_score' | 'position' | 'started_at' | 'completed_at' | 'recurrence_rule' | 'recurrence_parent_id' | 'google_event_id' | 'tenant_id' | 'created_at' | 'updated_at'>>;

export interface Subtasks extends Models.Document {
  task_id: string;
  title: string;
  completed?: boolean | null;
  position?: number | null;
  created_at?: string | null;
}
export type SubtasksInput = Pick<Subtasks, 'task_id' | 'title'> & Partial<Pick<Subtasks, 'completed' | 'position' | 'created_at'>>;

export interface Delegations extends Models.Document {
  task_id: string;
  delegated_by: string;
  delegated_to: string;
  status?: 'pending' | 'accepted' | 'completed' | 'rejected' | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type DelegationsInput = Pick<Delegations, 'task_id' | 'delegated_by' | 'delegated_to'> & Partial<Pick<Delegations, 'status' | 'notes' | 'created_at' | 'updated_at'>>;

export interface TaskShares extends Models.Document {
  task_id: string;
  shared_by: string;
  shared_with_email: string;
  shared_with_user_id?: string | null;
  permission?: 'view' | 'edit' | null;
  created_at?: string | null;
}
export type TaskSharesInput = Pick<TaskShares, 'task_id' | 'shared_by' | 'shared_with_email'> & Partial<Pick<TaskShares, 'shared_with_user_id' | 'permission' | 'created_at'>>;

/** storage_path vira bucket_id + file_id do Appwrite Storage; mantido por compatibilidade. */
export interface TaskAttachments extends Models.Document {
  task_id: string;
  uploaded_by: string;
  storage_path: string;
  bucket_id?: string | null;
  file_id?: string | null;
  mime_type: string;
  size_bytes?: number | null;
  ocr_text?: string | null;
  ai_description?: string | null;
  ai_analyzed_at?: string | null;
  created_at?: string | null;
}
export type TaskAttachmentsInput = Pick<TaskAttachments, 'task_id' | 'uploaded_by' | 'storage_path' | 'mime_type'> & Partial<Pick<TaskAttachments, 'bucket_id' | 'file_id' | 'size_bytes' | 'ocr_text' | 'ai_description' | 'ai_analyzed_at' | 'created_at'>>;

export interface TaskFocusSessions extends Models.Document {
  task_id: string;
  user_id: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  phase?: string | null;
  created_at?: string | null;
}
export type TaskFocusSessionsInput = Pick<TaskFocusSessions, 'task_id' | 'user_id'> & Partial<Pick<TaskFocusSessions, 'started_at' | 'ended_at' | 'duration_seconds' | 'phase' | 'created_at'>>;

export interface TaskReclassificationSuggestions extends Models.Document {
  task_id: string;
  user_id: string;
  current_quadrant: 'do' | 'schedule' | 'delegate' | 'eliminate';
  suggested_quadrant: 'do' | 'schedule' | 'delegate' | 'eliminate';
  current_importance: number;
  suggested_importance: number;
  current_urgency: number;
  applied_urgency: number;
  reason?: string | null;
  signals?: string | null;
  status?: 'pending' | 'accepted' | 'rejected' | 'expired' | null;
  created_at?: string | null;
  resolved_at?: string | null;
}
export type TaskReclassificationSuggestionsInput = Pick<TaskReclassificationSuggestions, 'task_id' | 'user_id' | 'current_quadrant' | 'suggested_quadrant' | 'current_importance' | 'suggested_importance' | 'current_urgency' | 'applied_urgency'> & Partial<Pick<TaskReclassificationSuggestions, 'reason' | 'signals' | 'status' | 'created_at' | 'resolved_at'>>;

export interface TaskReminders extends Models.Document {
  task_id: string;
  created_by: string;
  kind: 'due_d1' | 'due_1h' | 'due_now' | 'start_now' | 'start_5min' | 'custom' | 'daily_summary' | 'weekly_plan';
  scheduled_at?: string | null;
  recipients?: ('creator' | 'assignee' | 'shared')[] | null;
  channels?: ('in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email')[] | null;
  enabled?: boolean | null;
  auto_generated?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TaskRemindersInput = Pick<TaskReminders, 'task_id' | 'created_by' | 'kind'> & Partial<Pick<TaskReminders, 'scheduled_at' | 'recipients' | 'channels' | 'enabled' | 'auto_generated' | 'created_at' | 'updated_at'>>;

/** Fila processada por dispatch-reminders. Cliente só lê os próprios via permissão de documento. */
export interface ScheduledReminders extends Models.Document {
  task_reminder_id?: string | null;
  recurring_schedule_id?: string | null;
  task_id?: string | null;
  user_id: string;
  tenant_id?: string | null;
  kind: 'due_d1' | 'due_1h' | 'due_now' | 'start_now' | 'start_5min' | 'custom' | 'daily_summary' | 'weekly_plan';
  channel: 'in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email';
  scheduled_at: string;
  status?: 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | null;
  attempts?: number | null;
  last_error?: string | null;
  payload?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type ScheduledRemindersInput = Pick<ScheduledReminders, 'user_id' | 'kind' | 'channel' | 'scheduled_at'> & Partial<Pick<ScheduledReminders, 'task_reminder_id' | 'recurring_schedule_id' | 'task_id' | 'tenant_id' | 'status' | 'attempts' | 'last_error' | 'payload' | 'sent_at' | 'created_at' | 'updated_at'>>;

export interface RecurringSchedules extends Models.Document {
  user_id: string;
  tenant_id?: string | null;
  kind: 'due_d1' | 'due_1h' | 'due_now' | 'start_now' | 'start_5min' | 'custom' | 'daily_summary' | 'weekly_plan';
  cron_local?: string | null;
  weekday?: number | null;
  timezone?: string | null;
  channels?: ('in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email')[] | null;
  enabled?: boolean | null;
  last_run_at?: string | null;
  payload?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type RecurringSchedulesInput = Pick<RecurringSchedules, 'user_id' | 'kind'> & Partial<Pick<RecurringSchedules, 'tenant_id' | 'cron_local' | 'weekday' | 'timezone' | 'channels' | 'enabled' | 'last_run_at' | 'payload' | 'created_at' | 'updated_at'>>;

export interface UserReminderPreferences extends Models.Document {
  user_id: string;
  auto_due_d1?: boolean | null;
  auto_due_1h?: boolean | null;
  auto_due_now?: boolean | null;
  auto_start?: boolean | null;
  default_channels?: ('in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email')[] | null;
  default_recipients?: ('creator' | 'assignee' | 'shared')[] | null;
  timezone?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type UserReminderPreferencesInput = Pick<UserReminderPreferences, 'user_id'> & Partial<Pick<UserReminderPreferences, 'auto_due_d1' | 'auto_due_1h' | 'auto_due_now' | 'auto_start' | 'default_channels' | 'default_recipients' | 'timezone' | 'created_at' | 'updated_at'>>;

export interface Notifications extends Models.Document {
  user_id: string;
  type?: string | null;
  title: string;
  body?: string | null;
  metadata?: string | null;
  read?: boolean | null;
  created_at?: string | null;
}
export type NotificationsInput = Pick<Notifications, 'user_id' | 'title'> & Partial<Pick<Notifications, 'type' | 'body' | 'metadata' | 'read' | 'created_at'>>;

export interface ProductivityMetrics extends Models.Document {
  user_id: string;
  date: string;
  tasks_completed?: number | null;
  tasks_eliminated?: number | null;
  tasks_delegated?: number | null;
  time_in_important?: number | null;
  pomodoros_completed?: number | null;
  created_at?: string | null;
}
export type ProductivityMetricsInput = Pick<ProductivityMetrics, 'user_id' | 'date'> & Partial<Pick<ProductivityMetrics, 'tasks_completed' | 'tasks_eliminated' | 'tasks_delegated' | 'time_in_important' | 'pomodoros_completed' | 'created_at'>>;

export interface Gamification extends Models.Document {
  user_id: string;
  current_streak?: number | null;
  longest_streak?: number | null;
  last_active_date?: string | null;
  total_tasks_completed?: number | null;
  total_tasks_eliminated?: number | null;
  total_tasks_delegated?: number | null;
  total_focus_minutes?: number | null;
  total_pomodoros?: number | null;
  life_score?: number | null;
  level?: number | null;
  xp?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type GamificationInput = Pick<Gamification, 'user_id'> & Partial<Pick<Gamification, 'current_streak' | 'longest_streak' | 'last_active_date' | 'total_tasks_completed' | 'total_tasks_eliminated' | 'total_tasks_delegated' | 'total_focus_minutes' | 'total_pomodoros' | 'life_score' | 'level' | 'xp' | 'created_at' | 'updated_at'>>;

/** Escrita só pelo servidor — equivalente ao award_badge_if_earned (SECURITY DEFINER). */
export interface UserBadges extends Models.Document {
  user_id: string;
  badge_id: string;
  earned_at?: string | null;
}
export type UserBadgesInput = Pick<UserBadges, 'user_id' | 'badge_id'> & Partial<Pick<UserBadges, 'earned_at'>>;

/** SERVER-ONLY. No Supabase o cliente conseguia ler os tokens; aqui não. Melhoria deliberada. */
export interface GoogleCalendarTokens extends Models.Document {
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  calendar_id?: string | null;
  sync_enabled?: boolean | null;
  last_synced_at?: string | null;
  google_email?: string | null;
  is_revoked?: boolean | null;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type GoogleCalendarTokensInput = Pick<GoogleCalendarTokens, 'user_id' | 'access_token' | 'refresh_token' | 'token_expires_at'> & Partial<Pick<GoogleCalendarTokens, 'calendar_id' | 'sync_enabled' | 'last_synced_at' | 'google_email' | 'is_revoked' | 'revoked_at' | 'revoked_reason' | 'created_at' | 'updated_at'>>;

export interface GoogleTokenAuditLog extends Models.Document {
  user_id: string;
  action: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}
export type GoogleTokenAuditLogInput = Pick<GoogleTokenAuditLog, 'user_id' | 'action'> & Partial<Pick<GoogleTokenAuditLog, 'ip_address' | 'user_agent' | 'created_at'>>;

export interface WhatsappConnections extends Models.Document {
  user_id: string;
  instance_name: string;
  phone_number?: string | null;
  status?: string | null;
  qr_code?: string | null;
  reminders_enabled?: boolean | null;
  daily_report_enabled?: boolean | null;
  report_time?: string | null;
  reminder_times?: string | null;
  accept_messages_from?: string | null;
  weekly_report_enabled?: boolean | null;
  weekly_report_day?: number | null;
  weekly_report_time?: string | null;
  timezone?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type WhatsappConnectionsInput = Pick<WhatsappConnections, 'user_id' | 'instance_name'> & Partial<Pick<WhatsappConnections, 'phone_number' | 'status' | 'qr_code' | 'reminders_enabled' | 'daily_report_enabled' | 'report_time' | 'reminder_times' | 'accept_messages_from' | 'weekly_report_enabled' | 'weekly_report_day' | 'weekly_report_time' | 'timezone' | 'created_at' | 'updated_at'>>;

export interface TenantWhatsappConnections extends Models.Document {
  tenant_id: string;
  instance_name: string;
  phone_number?: string | null;
  status?: string | null;
  qr_code?: string | null;
  default_sender?: boolean | null;
  reminders_enabled?: boolean | null;
  daily_report_enabled?: boolean | null;
  weekly_report_enabled?: boolean | null;
  timezone?: string | null;
  created_by: string;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TenantWhatsappConnectionsInput = Pick<TenantWhatsappConnections, 'tenant_id' | 'instance_name' | 'created_by'> & Partial<Pick<TenantWhatsappConnections, 'phone_number' | 'status' | 'qr_code' | 'default_sender' | 'reminders_enabled' | 'daily_report_enabled' | 'weekly_report_enabled' | 'timezone' | 'created_at' | 'updated_at'>>;

export interface TenantMemberPhones extends Models.Document {
  tenant_id: string;
  user_id: string;
  phone_number: string;
  verified?: boolean | null;
  verification_code?: string | null;
  verification_expires_at?: string | null;
  receive_reminders?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TenantMemberPhonesInput = Pick<TenantMemberPhones, 'tenant_id' | 'user_id' | 'phone_number'> & Partial<Pick<TenantMemberPhones, 'verified' | 'verification_code' | 'verification_expires_at' | 'receive_reminders' | 'created_at' | 'updated_at'>>;

export interface WhatsappChatHistory extends Models.Document {
  user_id: string;
  role?: string | null;
  content: string;
  created_at?: string | null;
}
export type WhatsappChatHistoryInput = Pick<WhatsappChatHistory, 'user_id' | 'content'> & Partial<Pick<WhatsappChatHistory, 'role' | 'created_at'>>;

/** Deduplicação de webhook. Só o servidor toca. */
export interface WhatsappProcessedMessages extends Models.Document {
  message_id: string;
  instance_name: string;
  processed_at?: string | null;
}
export type WhatsappProcessedMessagesInput = Pick<WhatsappProcessedMessages, 'message_id' | 'instance_name'> & Partial<Pick<WhatsappProcessedMessages, 'processed_at'>>;

export interface WhatsappSentReminders extends Models.Document {
  user_id: string;
  task_id: string;
  reminder_type: string;
  sent_at?: string | null;
}
export type WhatsappSentRemindersInput = Pick<WhatsappSentReminders, 'user_id' | 'task_id' | 'reminder_type'> & Partial<Pick<WhatsappSentReminders, 'sent_at'>>;

export interface TenantMcpSettings extends Models.Document {
  tenant_id: string;
  enabled?: boolean | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type TenantMcpSettingsInput = Pick<TenantMcpSettings, 'tenant_id'> & Partial<Pick<TenantMcpSettings, 'enabled' | 'updated_by' | 'created_at' | 'updated_at'>>;

/** Hashes de chave. Nunca expor ao cliente — a UI lê via function, não direto. */
export interface TenantApiKeys extends Models.Document {
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes?: string[] | null;
  created_by: string;
  last_used_at?: string | null;
  last_used_ip?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string | null;
}
export type TenantApiKeysInput = Pick<TenantApiKeys, 'tenant_id' | 'name' | 'key_prefix' | 'key_hash' | 'created_by'> & Partial<Pick<TenantApiKeys, 'scopes' | 'last_used_at' | 'last_used_ip' | 'expires_at' | 'revoked_at' | 'created_at'>>;

export interface TenantApiAuditLog extends Models.Document {
  tenant_id: string;
  api_key_id?: string | null;
  tool?: string | null;
  status: string;
  error?: string | null;
  input_preview?: string | null;
  created_at?: string | null;
}
export type TenantApiAuditLogInput = Pick<TenantApiAuditLog, 'tenant_id' | 'status'> & Partial<Pick<TenantApiAuditLog, 'api_key_id' | 'tool' | 'error' | 'input_preview' | 'created_at'>>;

export interface IpWhitelist extends Models.Document {
  tenant_id: string;
  ip_address: string;
  label?: string | null;
  is_active?: boolean | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type IpWhitelistInput = Pick<IpWhitelist, 'tenant_id' | 'ip_address'> & Partial<Pick<IpWhitelist, 'label' | 'is_active' | 'created_by' | 'created_at' | 'updated_at'>>;

export interface IpAccessLog extends Models.Document {
  tenant_id?: string | null;
  user_id?: string | null;
  ip_address: string;
  endpoint: string;
  method: string;
  allowed: boolean;
  reason?: string | null;
  user_agent?: string | null;
  created_at?: string | null;
}
export type IpAccessLogInput = Pick<IpAccessLog, 'ip_address' | 'endpoint' | 'method' | 'allowed'> & Partial<Pick<IpAccessLog, 'tenant_id' | 'user_id' | 'reason' | 'user_agent' | 'created_at'>>;

/** No Postgres esta tabela ficou SEM RLS. Aqui é server-only por padrão. */
export interface SuspiciousIps extends Models.Document {
  ip_address: string;
  threat_level?: 'low' | 'medium' | 'high' | 'critical' | null;
  reason?: string | null;
  failed_attempts?: number | null;
  is_blocked?: boolean | null;
  block_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type SuspiciousIpsInput = Pick<SuspiciousIps, 'ip_address'> & Partial<Pick<SuspiciousIps, 'threat_level' | 'reason' | 'failed_attempts' | 'is_blocked' | 'block_until' | 'created_at' | 'updated_at'>>;

/** Só para as API keys de tenant (hermes-mcp). Rate limit de IP/abuse o Appwrite já faz nativamente. */
export interface RateLimitBuckets extends Models.Document {
  api_key: string;
  user_id?: string | null;
  tenant_id?: string | null;
  tokens_remaining?: number | null;
  tokens_capacity?: number | null;
  refill_rate?: number | null;
  refill_interval_seconds?: number | null;
  last_refill_at?: string | null;
  last_request_at?: string | null;
  total_requests?: number | null;
  blocked_requests?: number | null;
  is_unlimited?: boolean | null;
  is_blocked?: boolean | null;
  block_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export type RateLimitBucketsInput = Pick<RateLimitBuckets, 'api_key'> & Partial<Pick<RateLimitBuckets, 'user_id' | 'tenant_id' | 'tokens_remaining' | 'tokens_capacity' | 'refill_rate' | 'refill_interval_seconds' | 'last_refill_at' | 'last_request_at' | 'total_requests' | 'blocked_requests' | 'is_unlimited' | 'is_blocked' | 'block_reason' | 'created_at' | 'updated_at'>>;

export interface RateLimitEvents extends Models.Document {
  api_key: string;
  user_id?: string | null;
  tenant_id?: string | null;
  endpoint: string;
  method: string;
  ip_address?: string | null;
  user_agent?: string | null;
  status: 'allowed' | 'blocked' | 'warning';
  tokens_remaining?: number | null;
  tokens_used?: number | null;
  request_id?: string | null;
  created_at?: string | null;
}
export type RateLimitEventsInput = Pick<RateLimitEvents, 'api_key' | 'endpoint' | 'method' | 'status'> & Partial<Pick<RateLimitEvents, 'user_id' | 'tenant_id' | 'ip_address' | 'user_agent' | 'tokens_remaining' | 'tokens_used' | 'request_id' | 'created_at'>>;

/** Mapa collectionId -> tipo do documento, para helpers genéricos. */
export interface CollectionTypeMap {
  profiles: Profiles;
  user_roles: UserRoles;
  user_preferences: UserPreferences;
  tenants: Tenants;
  tenant_members: TenantMembers;
  tenant_invites: TenantInvites;
  teams: Teams;
  team_members: TeamMembers;
  team_invites: TeamInvites;
  projects: Projects;
  tasks: Tasks;
  subtasks: Subtasks;
  delegations: Delegations;
  task_shares: TaskShares;
  task_attachments: TaskAttachments;
  task_focus_sessions: TaskFocusSessions;
  task_reclassification_suggestions: TaskReclassificationSuggestions;
  task_reminders: TaskReminders;
  scheduled_reminders: ScheduledReminders;
  recurring_schedules: RecurringSchedules;
  user_reminder_preferences: UserReminderPreferences;
  notifications: Notifications;
  productivity_metrics: ProductivityMetrics;
  gamification: Gamification;
  user_badges: UserBadges;
  google_calendar_tokens: GoogleCalendarTokens;
  google_token_audit_log: GoogleTokenAuditLog;
  whatsapp_connections: WhatsappConnections;
  tenant_whatsapp_connections: TenantWhatsappConnections;
  tenant_member_phones: TenantMemberPhones;
  whatsapp_chat_history: WhatsappChatHistory;
  whatsapp_processed_messages: WhatsappProcessedMessages;
  whatsapp_sent_reminders: WhatsappSentReminders;
  tenant_mcp_settings: TenantMcpSettings;
  tenant_api_keys: TenantApiKeys;
  tenant_api_audit_log: TenantApiAuditLog;
  ip_whitelist: IpWhitelist;
  ip_access_log: IpAccessLog;
  suspicious_ips: SuspiciousIps;
  rate_limit_buckets: RateLimitBuckets;
  rate_limit_events: RateLimitEvents;
}
