/**
 * EisenFlow — Schema declarativo do Appwrite
 * Origem: Supabase/Postgres (projeto zmquepmvnelffcwvsuqv), reconstruído a partir
 * de 58 migrations + src/integrations/supabase/types.ts.
 *
 * Convenções da tradução Postgres -> Appwrite (detalhes em MIGRATION.md):
 *   uuid            -> string(36)        (referência solta; Appwrite não tem FK)
 *   text            -> string(N)
 *   timestamptz     -> datetime
 *   date            -> string(10)  'YYYY-MM-DD'  (permite índice único composto)
 *   time            -> string(8)   'HH:MM:SS'
 *   jsonb           -> string(65535) contendo JSON serializado
 *   enum            -> enum
 *   text[] / enum[] -> atributo array (SEM default — limitação do Appwrite)
 *   inet            -> string(45)
 *
 * Regras do Appwrite respeitadas aqui:
 *   - atributo array não aceita default e não pode ser required
 *   - atributo required não aceita default
 *   - índice só em string pequena (<= 255) — nunca em campo de texto longo
 *   - $id, $createdAt, $updatedAt são automáticos; created_at/updated_at foram
 *     mantidos explícitos para o front continuar lendo os mesmos nomes
 */

// ---------------------------------------------------------------- helpers
const str = (key, size, o = {}) => ({ key, type: 'string', size, required: false, ...o });
const ref = (key, o = {}) => str(key, 36, o);                    // ex-foreign key
const json = (key, o = {}) => str(key, 65535, o);
const int = (key, o = {}) => ({ key, type: 'integer', required: false, ...o });
const bool = (key, o = {}) => ({ key, type: 'boolean', required: false, ...o });
const dt = (key, o = {}) => ({ key, type: 'datetime', required: false, ...o });
const en = (key, elements, o = {}) => ({ key, type: 'enum', elements, required: false, ...o });

const idx = (key, attributes, orders = null) => ({ key, type: 'key', attributes, orders });
const uniq = (key, attributes) => ({ key, type: 'unique', attributes, orders: null });
const text = (key, attributes) => ({ key, type: 'fulltext', attributes, orders: null });

const stamps = () => [dt('created_at'), dt('updated_at')];

// ---------------------------------------------------------------- enums
export const ENUMS = {
  app_role: ['admin', 'member', 'super_admin'],
  delegation_status: ['pending', 'accepted', 'completed', 'rejected'],
  invite_status: ['pending', 'accepted', 'expired', 'cancelled'],
  reclassification_status: ['pending', 'accepted', 'rejected', 'expired'],
  reminder_channel: ['in_app', 'browser', 'whatsapp_personal', 'whatsapp_tenant', 'email'],
  reminder_kind: ['due_d1', 'due_1h', 'due_now', 'start_now', 'start_5min', 'custom', 'daily_summary', 'weekly_plan'],
  reminder_recipient: ['creator', 'assignee', 'shared'],
  scheduled_reminder_status: ['pending', 'sent', 'failed', 'skipped', 'cancelled'],
  share_permission: ['view', 'edit'],
  task_quadrant: ['do', 'schedule', 'delegate', 'eliminate'],
  task_status: ['pending', 'in_progress', 'completed', 'eliminated'],
  team_role: ['admin', 'manager', 'member'],
  tenant_role: ['owner', 'admin', 'member', 'guest'],
  threat_level: ['low', 'medium', 'high', 'critical'],
  rate_limit_status: ['allowed', 'blocked', 'warning'],
};
const E = ENUMS;

// ID do database no servidor. O database real do projeto foi criado pelo console
// e recebeu um ID gerado; por isso o valor vem de env, com esse ID como padrão.
export const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || '6a9887fe000ab0ab3b2e';
export const DATABASE_NAME = 'eisenflow';

/**
 * access:
 *   'user'       -> usuários autenticados podem criar; leitura/escrita por documento
 *   'server-doc' -> só a API key cria; o servidor concede leitura por documento
 *   'server'     -> exclusivo do servidor (API key). Cliente não enxerga.
 */
export const COLLECTIONS = [
  // ============================================================ IDENTIDADE
  {
    id: 'profiles', name: 'Profiles', group: 'core', access: 'user',
    note: 'Perfil público do usuário. user_id = $id da conta Appwrite.',
    attributes: [
      ref('user_id', { required: true }),
      str('display_name', 255),
      str('avatar_url', 2000),
      str('preferred_language', 10, { default: 'pt-BR' }),
      bool('disabled', { default: false }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_profiles_user', ['user_id']), text('ft_profiles_name', ['display_name'])],
  },
  {
    id: 'user_roles', name: 'User Roles', group: 'core', access: 'server-doc',
    note: 'Papéis globais. Em produção prefira labels do Appwrite; a collection existe para compatibilidade com useAdminGuard.',
    attributes: [
      ref('user_id', { required: true }),
      en('role', E.app_role, { required: true }),
    ],
    indexes: [uniq('uniq_user_role', ['user_id', 'role'])],
  },
  {
    id: 'user_preferences', name: 'User Preferences', group: 'extras', access: 'user',
    attributes: [
      ref('user_id', { required: true }),
      str('timezone', 64, { default: 'America/Sao_Paulo' }),
      str('language', 10, { default: 'pt-BR' }),
      str('date_format', 20, { default: 'YYYY-MM-DD' }),
      str('time_format', 8, { default: '24h' }),
      int('week_starts_on', { default: 0, min: 0, max: 6 }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_user_prefs', ['user_id'])],
  },

  // ============================================================ TENANTS / TIMES
  {
    id: 'tenants', name: 'Tenants', group: 'core', access: 'user',
    note: 'Espelha um Team nativo do Appwrite (appwrite_team_id) para controle de acesso.',
    attributes: [
      str('name', 255, { required: true }),
      str('slug', 64, { required: true }),
      str('logo_url', 2000),
      ref('created_by', { required: true }),
      ref('appwrite_team_id'),
      ...stamps(),
    ],
    indexes: [uniq('uniq_tenant_slug', ['slug']), idx('idx_tenant_creator', ['created_by']), idx('idx_tenant_team', ['appwrite_team_id'])],
  },
  {
    id: 'tenant_members', name: 'Tenant Members', group: 'core', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      ref('user_id', { required: true }),
      en('role', E.tenant_role, { default: 'member' }),
      dt('joined_at'),
    ],
    indexes: [uniq('uniq_tenant_member', ['tenant_id', 'user_id']), idx('idx_tm_user', ['user_id'])],
  },
  {
    id: 'tenant_invites', name: 'Tenant Invites', group: 'core', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      ref('invited_by', { required: true }),
      str('invited_email', 255),
      str('invite_code', 64, { required: true }),
      en('status', E.invite_status, { default: 'pending' }),
      en('role', E.tenant_role, { default: 'member' }),
      dt('created_at'), dt('expires_at'),
    ],
    indexes: [uniq('uniq_tenant_invite_code', ['invite_code']), idx('idx_ti_tenant', ['tenant_id']), idx('idx_ti_email', ['invited_email'])],
  },
  {
    id: 'teams', name: 'Teams', group: 'core', access: 'user',
    note: 'Times internos de um tenant (não confundir com Teams nativos do Appwrite, usados para tenants).',
    attributes: [
      str('name', 255, { required: true }),
      str('description', 2000),
      str('avatar_url', 2000),
      ref('created_by', { required: true }),
      ref('tenant_id'),
      ...stamps(),
    ],
    indexes: [idx('idx_teams_tenant', ['tenant_id']), idx('idx_teams_creator', ['created_by'])],
  },
  {
    id: 'team_members', name: 'Team Members', group: 'core', access: 'server-doc',
    attributes: [
      ref('team_id', { required: true }),
      ref('user_id', { required: true }),
      en('role', E.team_role, { default: 'member' }),
      dt('joined_at'),
    ],
    indexes: [uniq('uniq_team_member', ['team_id', 'user_id']), idx('idx_tmem_user', ['user_id'])],
  },
  {
    id: 'team_invites', name: 'Team Invites', group: 'core', access: 'server-doc',
    attributes: [
      ref('team_id', { required: true }),
      ref('invited_by', { required: true }),
      str('invited_email', 255),
      str('invite_code', 64, { required: true }),
      en('status', E.invite_status, { default: 'pending' }),
      en('role', E.team_role, { default: 'member' }),
      dt('created_at'), dt('expires_at'),
    ],
    indexes: [uniq('uniq_team_invite_code', ['invite_code']), idx('idx_tinv_team', ['team_id']), idx('idx_tinv_email', ['invited_email'])],
  },

  // ============================================================ NÚCLEO: TAREFAS
  {
    id: 'projects', name: 'Projects', group: 'core', access: 'user',
    attributes: [
      str('name', 255, { required: true }),
      str('color', 9, { default: '#6366f1' }),
      ref('owner_id', { required: true }),
      ref('team_id'),
      ref('tenant_id'),
      bool('archived', { default: false }),
      ...stamps(),
    ],
    indexes: [idx('idx_proj_owner', ['owner_id']), idx('idx_proj_tenant', ['tenant_id']), idx('idx_proj_team', ['team_id']), idx('idx_proj_archived', ['archived'])],
  },
  {
    id: 'tasks', name: 'Tasks', group: 'core', access: 'user',
    attributes: [
      str('title', 500, { required: true }),
      str('description', 20000),
      int('urgency', { default: 3, min: 1, max: 5 }),
      int('importance', { default: 3, min: 1, max: 5 }),
      en('quadrant', E.task_quadrant, { default: 'do' }),
      dt('due_date'),
      int('estimated_time', { min: 0, max: 100000 }),
      en('status', E.task_status, { default: 'pending' }),
      ref('project_id'),
      ref('created_by', { required: true }),
      ref('assigned_to'),
      str('tags', 100, { array: true }),
      int('impact_score', { default: 0, min: 0, max: 100 }),
      int('position', { default: 0, min: 0, max: 1000000 }),
      dt('started_at'),
      dt('completed_at'),
      str('recurrence_rule', 255),
      ref('recurrence_parent_id'),
      str('google_event_id', 255),
      ref('tenant_id'),
      ...stamps(),
    ],
    indexes: [
      idx('idx_tasks_creator', ['created_by']),
      idx('idx_tasks_assignee', ['assigned_to']),
      idx('idx_tasks_tenant', ['tenant_id']),
      idx('idx_tasks_project', ['project_id']),
      idx('idx_tasks_status', ['status']),
      idx('idx_tasks_quadrant', ['quadrant']),
      idx('idx_tasks_due', ['due_date'], ['ASC']),
      idx('idx_tasks_creator_status', ['created_by', 'status']),
      idx('idx_tasks_recur_parent', ['recurrence_parent_id']),
      idx('idx_tasks_gcal', ['google_event_id']),
      text('ft_tasks_title', ['title']),
    ],
  },
  {
    id: 'subtasks', name: 'Subtasks', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      str('title', 500, { required: true }),
      bool('completed', { default: false }),
      int('position', { default: 0, min: 0, max: 100000 }),
      dt('created_at'),
    ],
    indexes: [idx('idx_sub_task', ['task_id'])],
  },
  {
    id: 'delegations', name: 'Delegations', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      ref('delegated_by', { required: true }),
      ref('delegated_to', { required: true }),
      en('status', E.delegation_status, { default: 'pending' }),
      str('notes', 5000),
      ...stamps(),
    ],
    indexes: [idx('idx_del_task', ['task_id']), idx('idx_del_to', ['delegated_to']), idx('idx_del_by', ['delegated_by'])],
  },
  {
    id: 'task_shares', name: 'Task Shares', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      ref('shared_by', { required: true }),
      str('shared_with_email', 255, { required: true }),
      ref('shared_with_user_id'),
      en('permission', E.share_permission, { default: 'view' }),
      dt('created_at'),
    ],
    indexes: [uniq('uniq_share', ['task_id', 'shared_with_email']), idx('idx_share_user', ['shared_with_user_id']), idx('idx_share_email', ['shared_with_email'])],
  },
  {
    id: 'task_attachments', name: 'Task Attachments', group: 'core', access: 'user',
    note: 'storage_path vira bucket_id + file_id do Appwrite Storage; mantido por compatibilidade.',
    attributes: [
      ref('task_id', { required: true }),
      ref('uploaded_by', { required: true }),
      str('storage_path', 1000, { required: true }),
      str('bucket_id', 64, { default: 'task-attachments' }),
      ref('file_id'),
      str('mime_type', 100, { required: true }),
      int('size_bytes', { default: 0, min: 0, max: 2147483647 }),
      str('ocr_text', 65535),
      str('ai_description', 20000),
      dt('ai_analyzed_at'),
      dt('created_at'),
    ],
    indexes: [idx('idx_att_task', ['task_id']), idx('idx_att_uploader', ['uploaded_by'])],
  },
  {
    id: 'task_focus_sessions', name: 'Focus Sessions', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      ref('user_id', { required: true }),
      dt('started_at'), dt('ended_at'),
      int('duration_seconds', { default: 0, min: 0, max: 2147483647 }),
      str('phase', 20, { default: 'focus' }),
      dt('created_at'),
    ],
    indexes: [idx('idx_focus_task', ['task_id']), idx('idx_focus_user', ['user_id'])],
  },
  {
    id: 'task_reclassification_suggestions', name: 'Reclassification Suggestions', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      ref('user_id', { required: true }),
      en('current_quadrant', E.task_quadrant, { required: true }),
      en('suggested_quadrant', E.task_quadrant, { required: true }),
      int('current_importance', { required: true, min: 1, max: 5 }),
      int('suggested_importance', { required: true, min: 1, max: 5 }),
      int('current_urgency', { required: true, min: 1, max: 5 }),
      int('applied_urgency', { required: true, min: 1, max: 5 }),
      str('reason', 5000),
      json('signals'),
      en('status', E.reclassification_status, { default: 'pending' }),
      dt('created_at'), dt('resolved_at'),
    ],
    indexes: [idx('idx_reclass_user_status', ['user_id', 'status']), idx('idx_reclass_task', ['task_id'])],
  },

  // ============================================================ LEMBRETES
  {
    id: 'task_reminders', name: 'Task Reminders', group: 'core', access: 'user',
    attributes: [
      ref('task_id', { required: true }),
      ref('created_by', { required: true }),
      en('kind', E.reminder_kind, { required: true }),
      dt('scheduled_at'),
      en('recipients', E.reminder_recipient, { array: true }),
      en('channels', E.reminder_channel, { array: true }),
      bool('enabled', { default: true }),
      bool('auto_generated', { default: false }),
      ...stamps(),
    ],
    indexes: [idx('idx_rem_task', ['task_id']), idx('idx_rem_sched', ['scheduled_at'], ['ASC']), idx('idx_rem_task_kind', ['task_id', 'kind'])],
  },
  {
    id: 'scheduled_reminders', name: 'Scheduled Reminders (fila)', group: 'core', access: 'server-doc',
    note: 'Fila processada por dispatch-reminders. Cliente só lê os próprios via permissão de documento.',
    attributes: [
      ref('task_reminder_id'),
      ref('recurring_schedule_id'),
      ref('task_id'),
      ref('user_id', { required: true }),
      ref('tenant_id'),
      en('kind', E.reminder_kind, { required: true }),
      en('channel', E.reminder_channel, { required: true }),
      dt('scheduled_at', { required: true }),
      en('status', E.scheduled_reminder_status, { default: 'pending' }),
      int('attempts', { default: 0, min: 0, max: 1000 }),
      str('last_error', 5000),
      json('payload'),
      dt('sent_at'),
      ...stamps(),
    ],
    indexes: [idx('idx_sched_status_at', ['status', 'scheduled_at']), idx('idx_sched_user', ['user_id']), idx('idx_sched_reminder', ['task_reminder_id'])],
  },
  {
    id: 'recurring_schedules', name: 'Recurring Schedules', group: 'core', access: 'user',
    attributes: [
      ref('user_id', { required: true }),
      ref('tenant_id'),
      en('kind', E.reminder_kind, { required: true }),
      str('cron_local', 16, { default: '08:00' }),
      int('weekday', { min: 0, max: 6 }),
      str('timezone', 64, { default: 'America/Sao_Paulo' }),
      en('channels', E.reminder_channel, { array: true }),
      bool('enabled', { default: true }),
      dt('last_run_at'),
      json('payload'),
      ...stamps(),
    ],
    indexes: [idx('idx_recur_user', ['user_id']), idx('idx_recur_enabled', ['enabled'])],
  },
  {
    id: 'user_reminder_preferences', name: 'Reminder Preferences', group: 'core', access: 'user',
    attributes: [
      ref('user_id', { required: true }),
      bool('auto_due_d1', { default: true }),
      bool('auto_due_1h', { default: true }),
      bool('auto_due_now', { default: true }),
      bool('auto_start', { default: true }),
      en('default_channels', E.reminder_channel, { array: true }),
      en('default_recipients', E.reminder_recipient, { array: true }),
      str('timezone', 64, { default: 'America/Sao_Paulo' }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_rem_prefs_user', ['user_id'])],
  },
  {
    id: 'notifications', name: 'Notifications', group: 'core', access: 'server-doc',
    attributes: [
      ref('user_id', { required: true }),
      str('type', 50, { default: 'task_delegated' }),
      str('title', 255, { required: true }),
      str('body', 5000),
      json('metadata'),
      bool('read', { default: false }),
      dt('created_at'),
    ],
    indexes: [idx('idx_notif_user_read', ['user_id', 'read']), idx('idx_notif_user_at', ['user_id', 'created_at'], ['ASC', 'DESC'])],
  },

  // ============================================================ MÉTRICAS / GAMIFICAÇÃO
  {
    id: 'productivity_metrics', name: 'Productivity Metrics', group: 'core', access: 'user',
    attributes: [
      ref('user_id', { required: true }),
      str('date', 10, { required: true }),
      int('tasks_completed', { default: 0, min: 0, max: 100000 }),
      int('tasks_eliminated', { default: 0, min: 0, max: 100000 }),
      int('tasks_delegated', { default: 0, min: 0, max: 100000 }),
      int('time_in_important', { default: 0, min: 0, max: 10000000 }),
      int('pomodoros_completed', { default: 0, min: 0, max: 100000 }),
      dt('created_at'),
    ],
    indexes: [uniq('uniq_metrics_user_date', ['user_id', 'date'])],
  },
  {
    id: 'gamification', name: 'Gamification', group: 'core', access: 'user',
    attributes: [
      ref('user_id', { required: true }),
      int('current_streak', { default: 0, min: 0, max: 100000 }),
      int('longest_streak', { default: 0, min: 0, max: 100000 }),
      str('last_active_date', 10),
      int('total_tasks_completed', { default: 0, min: 0, max: 10000000 }),
      int('total_tasks_eliminated', { default: 0, min: 0, max: 10000000 }),
      int('total_tasks_delegated', { default: 0, min: 0, max: 10000000 }),
      int('total_focus_minutes', { default: 0, min: 0, max: 10000000 }),
      int('total_pomodoros', { default: 0, min: 0, max: 10000000 }),
      int('life_score', { default: 0, min: 0, max: 1000000 }),
      int('level', { default: 1, min: 1, max: 1000 }),
      int('xp', { default: 0, min: 0, max: 100000000 }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_gami_user', ['user_id'])],
  },
  {
    id: 'user_badges', name: 'User Badges', group: 'core', access: 'server-doc',
    note: 'Escrita só pelo servidor — equivalente ao award_badge_if_earned (SECURITY DEFINER).',
    attributes: [
      ref('user_id', { required: true }),
      str('badge_id', 64, { required: true }),
      dt('earned_at'),
    ],
    indexes: [uniq('uniq_badge', ['user_id', 'badge_id'])],
  },

  // ============================================================ INTEGRAÇÕES
  {
    id: 'google_calendar_tokens', name: 'Google Calendar Tokens', group: 'core', access: 'server',
    note: 'SERVER-ONLY. No Supabase o cliente conseguia ler os tokens; aqui não. Melhoria deliberada.',
    attributes: [
      ref('user_id', { required: true }),
      // MULTI-TENANT: um único app OAuth do EisenFlow no Google Cloud, mas cada
      // TENANT conecta a própria conta Google. A conexão é (user_id, tenant_id):
      // o mesmo usuário pode ter contas Google diferentes em tenants diferentes.
      ref('tenant_id', { required: true }),
      // access_token/refresh_token guardam o blob AES-256-GCM montado por
      // functions/_shared/cripto.js: base64(iv[12] + authTag[16] + ciphertext).
      str('access_token', 5000, { required: true }),
      str('refresh_token', 5000, { required: true }),
      dt('token_expires_at', { required: true }),
      str('calendar_id', 255, { default: 'primary' }),
      bool('sync_enabled', { default: true }),
      dt('last_synced_at'),
      str('google_email', 320),
      bool('is_revoked', { default: false }),
      dt('revoked_at'),
      str('revoked_reason', 500),
      ...stamps(),
    ],
    // O índice único passou de (user_id) para (user_id, tenant_id): amarrar a
    // conexão só ao usuário impedia o multi-tenant.
    // ATENÇÃO: migrate.mjs só CRIA índices (POST), nunca substitui. Num servidor
    // que já rodou a migração antes desta mudança, o índice antigo
    // `uniq_gcal_user` continua lá e precisa ser removido À MÃO no console do
    // Appwrite (Databases → google_calendar_tokens → Indexes), senão o segundo
    // tenant do mesmo usuário é rejeitado por duplicidade.
    indexes: [
      uniq('uniq_gcal_user_tenant', ['user_id', 'tenant_id']),
      idx('idx_gcal_tenant', ['tenant_id']),
    ],
  },
  {
    id: 'google_token_audit_log', name: 'Google Token Audit Log', group: 'extras', access: 'server',
    attributes: [
      ref('user_id', { required: true }),
      // Auditoria por tenant: a conexão do Google é do tenant, não só do usuário.
      ref('tenant_id'),
      str('action', 64, { required: true }),   // connect | refresh | revoke
      str('ip_address', 45),
      str('user_agent', 500),
      dt('created_at'),
    ],
    indexes: [idx('idx_gtal_user', ['user_id']), idx('idx_gtal_tenant', ['tenant_id'])],
  },
  {
    id: 'whatsapp_connections', name: 'WhatsApp Connections (pessoal)', group: 'core', access: 'server-doc',
    attributes: [
      ref('user_id', { required: true }),
      str('instance_name', 128, { required: true }),
      // Evolution GO identifica a instância pelo TOKEN dela (não pelo nome no path):
      // sem guardar o token aqui, não há como enviar mensagem nem ler status.
      str('instance_token', 128),
      str('instance_id', 64),
      str('phone_number', 32),
      str('status', 32, { default: 'disconnected' }),
      str('qr_code', 65535),
      bool('reminders_enabled', { default: false }),
      bool('daily_report_enabled', { default: false }),
      str('report_time', 8, { default: '08:00:00' }),
      str('reminder_times', 128, { default: '08:00,12:00,18:00' }),
      str('accept_messages_from', 32, { default: 'self_only' }),
      bool('weekly_report_enabled', { default: false }),
      int('weekly_report_day', { default: 1, min: 0, max: 6 }),
      str('weekly_report_time', 8, { default: '08:00:00' }),
      str('timezone', 64, { default: 'America/Sao_Paulo' }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_wa_user', ['user_id']), idx('idx_wa_instance', ['instance_name'])],
  },
  {
    id: 'tenant_whatsapp_connections', name: 'WhatsApp Connections (tenant)', group: 'core', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      str('instance_name', 128, { required: true }),
      // ver nota em whatsapp_connections: o token É a credencial da instância.
      str('instance_token', 128),
      str('instance_id', 64),
      str('phone_number', 32),
      str('status', 32, { default: 'disconnected' }),
      str('qr_code', 65535),
      bool('default_sender', { default: true }),
      bool('reminders_enabled', { default: true }),
      bool('daily_report_enabled', { default: false }),
      bool('weekly_report_enabled', { default: false }),
      str('timezone', 64, { default: 'America/Sao_Paulo' }),
      ref('created_by', { required: true }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_twa_tenant', ['tenant_id']), idx('idx_twa_instance', ['instance_name'])],
  },
  {
    id: 'tenant_member_phones', name: 'Tenant Member Phones', group: 'core', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      ref('user_id', { required: true }),
      str('phone_number', 32, { required: true }),
      bool('verified', { default: false }),
      str('verification_code', 16),
      dt('verification_expires_at'),
      bool('receive_reminders', { default: true }),
      ...stamps(),
    ],
    indexes: [uniq('uniq_tmp_tenant_user', ['tenant_id', 'user_id'])],
  },
  {
    id: 'whatsapp_chat_history', name: 'WhatsApp Chat History', group: 'core', access: 'server-doc',
    attributes: [
      ref('user_id', { required: true }),
      str('role', 16, { default: 'user' }),
      str('content', 65535, { required: true }),
      dt('created_at'),
    ],
    indexes: [idx('idx_wch_user_at', ['user_id', 'created_at'], ['ASC', 'DESC'])],
  },
  {
    id: 'whatsapp_processed_messages', name: 'WhatsApp Processed Messages', group: 'core', access: 'server',
    note: 'Deduplicação de webhook. Só o servidor toca.',
    attributes: [
      str('message_id', 128, { required: true }),
      str('instance_name', 128, { required: true }),
      dt('processed_at'),
    ],
    indexes: [uniq('uniq_wpm_message', ['message_id']), idx('idx_wpm_at', ['processed_at'], ['DESC'])],
  },
  {
    id: 'whatsapp_sent_reminders', name: 'WhatsApp Sent Reminders', group: 'core', access: 'server',
    attributes: [
      ref('user_id', { required: true }),
      ref('task_id', { required: true }),
      str('reminder_type', 32, { required: true }),
      dt('sent_at'),
    ],
    indexes: [uniq('uniq_wsr', ['user_id', 'task_id', 'reminder_type'])],
  },

  // ============================================================ MCP / API DE TENANT
  {
    id: 'tenant_mcp_settings', name: 'Tenant MCP Settings', group: 'core', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      bool('enabled', { default: false }),
      ref('updated_by'),
      ...stamps(),
    ],
    indexes: [uniq('uniq_mcp_tenant', ['tenant_id'])],
  },
  {
    id: 'tenant_api_keys', name: 'Tenant API Keys', group: 'core', access: 'server',
    note: 'Hashes de chave. Nunca expor ao cliente — a UI lê via function, não direto.',
    attributes: [
      ref('tenant_id', { required: true }),
      str('name', 255, { required: true }),
      str('key_prefix', 16, { required: true }),
      str('key_hash', 128, { required: true }),
      str('scopes', 64, { array: true }),
      ref('created_by', { required: true }),
      dt('last_used_at'),
      str('last_used_ip', 45),
      dt('expires_at'),
      dt('revoked_at'),
      dt('created_at'),
    ],
    indexes: [uniq('uniq_apikey_hash', ['key_hash']), idx('idx_apikey_tenant', ['tenant_id'])],
  },
  {
    id: 'tenant_api_audit_log', name: 'Tenant API Audit Log', group: 'core', access: 'server',
    attributes: [
      ref('tenant_id', { required: true }),
      ref('api_key_id'),
      str('tool', 100),
      str('status', 32, { required: true }),
      str('error', 5000),
      json('input_preview'),
      dt('created_at'),
    ],
    indexes: [idx('idx_audit_tenant_at', ['tenant_id', 'created_at'], ['ASC', 'DESC'])],
  },

  // ============================================================ EXTRAS DE SEGURANÇA
  {
    id: 'ip_whitelist', name: 'IP Whitelist', group: 'extras', access: 'server-doc',
    attributes: [
      ref('tenant_id', { required: true }),
      str('ip_address', 45, { required: true }),
      str('label', 255),
      bool('is_active', { default: true }),
      ref('created_by'),
      ...stamps(),
    ],
    indexes: [uniq('uniq_ipwl', ['tenant_id', 'ip_address']), idx('idx_ipwl_tenant', ['tenant_id', 'is_active'])],
  },
  {
    id: 'ip_access_log', name: 'IP Access Log', group: 'extras', access: 'server',
    attributes: [
      ref('tenant_id'),
      ref('user_id'),
      str('ip_address', 45, { required: true }),
      str('endpoint', 255, { required: true }),
      str('method', 10, { required: true }),
      bool('allowed', { required: true }),
      str('reason', 500),
      str('user_agent', 500),
      dt('created_at'),
    ],
    indexes: [idx('idx_ipal_ip', ['ip_address']), idx('idx_ipal_tenant', ['tenant_id'])],
  },
  {
    id: 'suspicious_ips', name: 'Suspicious IPs', group: 'extras', access: 'server',
    note: 'No Postgres esta tabela ficou SEM RLS. Aqui é server-only por padrão.',
    attributes: [
      str('ip_address', 45, { required: true }),
      en('threat_level', E.threat_level, { default: 'low' }),
      str('reason', 500),
      int('failed_attempts', { default: 0, min: 0, max: 1000000 }),
      bool('is_blocked', { default: false }),
      dt('block_until'),
      ...stamps(),
    ],
    indexes: [uniq('uniq_susp_ip', ['ip_address']), idx('idx_susp_blocked', ['is_blocked'])],
  },
  {
    id: 'rate_limit_buckets', name: 'Rate Limit Buckets', group: 'extras', access: 'server',
    note: 'Só para as API keys de tenant (hermes-mcp). Rate limit de IP/abuse o Appwrite já faz nativamente.',
    attributes: [
      str('api_key', 128, { required: true }),
      ref('user_id'),
      ref('tenant_id'),
      int('tokens_remaining', { default: 120, min: 0, max: 1000000 }),
      int('tokens_capacity', { default: 120, min: 0, max: 1000000 }),
      int('refill_rate', { default: 2, min: 0, max: 100000 }),
      int('refill_interval_seconds', { default: 60, min: 1, max: 86400 }),
      dt('last_refill_at'),
      dt('last_request_at'),
      int('total_requests', { default: 0, min: 0, max: 2147483647 }),
      int('blocked_requests', { default: 0, min: 0, max: 2147483647 }),
      bool('is_unlimited', { default: false }),
      bool('is_blocked', { default: false }),
      str('block_reason', 500),
      ...stamps(),
    ],
    indexes: [uniq('uniq_rlb_key', ['api_key']), idx('idx_rlb_tenant', ['tenant_id'])],
  },
  {
    id: 'rate_limit_events', name: 'Rate Limit Events', group: 'extras', access: 'server',
    attributes: [
      str('api_key', 128, { required: true }),
      ref('user_id'),
      ref('tenant_id'),
      str('endpoint', 255, { required: true }),
      str('method', 10, { required: true }),
      str('ip_address', 45),
      str('user_agent', 500),
      en('status', E.rate_limit_status, { required: true }),
      int('tokens_remaining', { default: 0, min: 0, max: 1000000 }),
      int('tokens_used', { default: 1, min: 0, max: 1000000 }),
      str('request_id', 64),
      dt('created_at'),
    ],
    indexes: [idx('idx_rle_key', ['api_key']), idx('idx_rle_at', ['created_at'], ['DESC'])],
  },
];

// ---------------------------------------------------------------- buckets
export const BUCKETS = [
  {
    id: 'task-attachments', name: 'Task Attachments', access: 'user',
    maximumFileSize: 10 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'txt', 'md', 'csv', 'docx', 'xlsx'],
    fileSecurity: true, encryption: true, antivirus: true,
  },
  {
    id: 'chat-attachments', name: 'Chat Attachments', access: 'user',
    maximumFileSize: 10 * 1024 * 1024,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'ogg', 'mp3', 'm4a'],
    fileSecurity: true, encryption: true, antivirus: true,
  },
  {
    id: 'tenant-logos', name: 'Tenant Logos', access: 'public-read',
    maximumFileSize: 2 * 1024 * 1024,
    allowedFileExtensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
    fileSecurity: true, encryption: false, antivirus: true,
  },
  {
    id: 'avatars', name: 'Avatars', access: 'public-read',
    maximumFileSize: 2 * 1024 * 1024,
    allowedFileExtensions: ['png', 'jpg', 'jpeg', 'webp'],
    fileSecurity: true, encryption: false, antivirus: true,
  },
];

/**
 * Tabelas do Postgres deliberadamente NÃO migradas — o Appwrite já resolve nativamente.
 * Documentado aqui para não parecer esquecimento.
 */
export const INTENTIONALLY_SKIPPED = {
  user_2fa: 'Appwrite MFA nativo (account.createMfaAuthenticator TOTP + códigos de recuperação)',
  admin_2fa_enforcement: 'Política de MFA do projeto Appwrite (Auth > Security)',
  failed_2fa_attempts: 'Abuse/rate limit nativo do Appwrite',
  session_tokens: 'Sessões nativas do Appwrite (account.listSessions / deleteSession)',
  token_rotation_log: 'Logs de sessão nativos do Appwrite',
  rate_limit_ips: 'Rate limit por IP nativo do Appwrite',
  'auth.users.timezone': 'Vive em user_preferences.timezone (a migration original alterava o schema auth do Supabase)',
};
