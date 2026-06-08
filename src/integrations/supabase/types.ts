export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      delegations: {
        Row: {
          created_at: string
          delegated_by: string
          delegated_to: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["delegation_status"]
          task_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delegated_by: string
          delegated_to: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["delegation_status"]
          task_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delegated_by?: string
          delegated_to?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["delegation_status"]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification: {
        Row: {
          created_at: string
          current_streak: number
          id: string
          last_active_date: string | null
          level: number
          life_score: number
          longest_streak: number
          total_focus_minutes: number
          total_pomodoros: number
          total_tasks_completed: number
          total_tasks_delegated: number
          total_tasks_eliminated: number
          updated_at: string
          user_id: string
          xp: number
        }
        Insert: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          level?: number
          life_score?: number
          longest_streak?: number
          total_focus_minutes?: number
          total_pomodoros?: number
          total_tasks_completed?: number
          total_tasks_delegated?: number
          total_tasks_eliminated?: number
          updated_at?: string
          user_id: string
          xp?: number
        }
        Update: {
          created_at?: string
          current_streak?: number
          id?: string
          last_active_date?: string | null
          level?: number
          life_score?: number
          longest_streak?: number
          total_focus_minutes?: number
          total_pomodoros?: number
          total_tasks_completed?: number
          total_tasks_delegated?: number
          total_tasks_eliminated?: number
          updated_at?: string
          user_id?: string
          xp?: number
        }
        Relationships: []
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string
          created_at: string
          google_email: string | null
          id: string
          last_synced_at: string | null
          refresh_token: string
          sync_enabled: boolean
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string
          created_at?: string
          google_email?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token: string
          sync_enabled?: boolean
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string
          created_at?: string
          google_email?: string | null
          id?: string
          last_synced_at?: string | null
          refresh_token?: string
          sync_enabled?: boolean
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          metadata: Json | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      productivity_metrics: {
        Row: {
          created_at: string
          date: string
          id: string
          pomodoros_completed: number
          tasks_completed: number
          tasks_delegated: number
          tasks_eliminated: number
          time_in_important: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          pomodoros_completed?: number
          tasks_completed?: number
          tasks_delegated?: number
          tasks_eliminated?: number
          time_in_important?: number
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          pomodoros_completed?: number
          tasks_completed?: number
          tasks_delegated?: number
          tasks_eliminated?: number
          time_in_important?: number
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          disabled: boolean
          display_name: string | null
          id: string
          preferred_language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          id?: string
          preferred_language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          id?: string
          preferred_language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived: boolean
          color: string
          created_at: string
          id: string
          name: string
          owner_id: string
          team_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          team_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          team_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_schedules: {
        Row: {
          channels: Database["public"]["Enums"]["reminder_channel"][]
          created_at: string
          cron_local: string
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          last_run_at: string | null
          payload: Json
          tenant_id: string | null
          timezone: string
          updated_at: string
          user_id: string
          weekday: number | null
        }
        Insert: {
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          cron_local?: string
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          last_run_at?: string | null
          payload?: Json
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
          weekday?: number | null
        }
        Update: {
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          cron_local?: string
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["reminder_kind"]
          last_run_at?: string | null
          payload?: Json
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
          weekday?: number | null
        }
        Relationships: []
      }
      scheduled_reminders: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          last_error: string | null
          payload: Json
          recurring_schedule_id: string | null
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["scheduled_reminder_status"]
          task_id: string | null
          task_reminder_id: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          last_error?: string | null
          payload?: Json
          recurring_schedule_id?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["scheduled_reminder_status"]
          task_id?: string | null
          task_reminder_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["reminder_kind"]
          last_error?: string | null
          payload?: Json
          recurring_schedule_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["scheduled_reminder_status"]
          task_id?: string | null
          task_reminder_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          position: number
          task_id: string
          title: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          position?: number
          task_id: string
          title: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          position?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          ai_analyzed_at: string | null
          ai_description: string | null
          created_at: string
          id: string
          mime_type: string
          ocr_text: string | null
          size_bytes: number
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          ai_analyzed_at?: string | null
          ai_description?: string | null
          created_at?: string
          id?: string
          mime_type: string
          ocr_text?: string | null
          size_bytes?: number
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          ai_analyzed_at?: string | null
          ai_description?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          ocr_text?: string | null
          size_bytes?: number
          storage_path?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      task_focus_sessions: {
        Row: {
          created_at: string
          duration_seconds: number
          ended_at: string | null
          id: string
          phase: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          phase?: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          ended_at?: string | null
          id?: string
          phase?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_focus_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reclassification_suggestions: {
        Row: {
          applied_urgency: number
          created_at: string
          current_importance: number
          current_quadrant: Database["public"]["Enums"]["task_quadrant"]
          current_urgency: number
          id: string
          reason: string | null
          resolved_at: string | null
          signals: Json
          status: Database["public"]["Enums"]["reclassification_status"]
          suggested_importance: number
          suggested_quadrant: Database["public"]["Enums"]["task_quadrant"]
          task_id: string
          user_id: string
        }
        Insert: {
          applied_urgency: number
          created_at?: string
          current_importance: number
          current_quadrant: Database["public"]["Enums"]["task_quadrant"]
          current_urgency: number
          id?: string
          reason?: string | null
          resolved_at?: string | null
          signals?: Json
          status?: Database["public"]["Enums"]["reclassification_status"]
          suggested_importance: number
          suggested_quadrant: Database["public"]["Enums"]["task_quadrant"]
          task_id: string
          user_id: string
        }
        Update: {
          applied_urgency?: number
          created_at?: string
          current_importance?: number
          current_quadrant?: Database["public"]["Enums"]["task_quadrant"]
          current_urgency?: number
          id?: string
          reason?: string | null
          resolved_at?: string | null
          signals?: Json
          status?: Database["public"]["Enums"]["reclassification_status"]
          suggested_importance?: number
          suggested_quadrant?: Database["public"]["Enums"]["task_quadrant"]
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      task_reminders: {
        Row: {
          auto_generated: boolean
          channels: Database["public"]["Enums"]["reminder_channel"][]
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          recipients: Database["public"]["Enums"]["reminder_recipient"][]
          scheduled_at: string | null
          task_id: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          created_by: string
          enabled?: boolean
          id?: string
          kind: Database["public"]["Enums"]["reminder_kind"]
          recipients?: Database["public"]["Enums"]["reminder_recipient"][]
          scheduled_at?: string | null
          task_id: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          channels?: Database["public"]["Enums"]["reminder_channel"][]
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["reminder_kind"]
          recipients?: Database["public"]["Enums"]["reminder_recipient"][]
          scheduled_at?: string | null
          task_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      task_shares: {
        Row: {
          created_at: string
          id: string
          permission: Database["public"]["Enums"]["share_permission"]
          shared_by: string
          shared_with_email: string
          shared_with_user_id: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission?: Database["public"]["Enums"]["share_permission"]
          shared_by: string
          shared_with_email: string
          shared_with_user_id?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: Database["public"]["Enums"]["share_permission"]
          shared_by?: string
          shared_with_email?: string
          shared_with_user_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_shares_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          estimated_time: number | null
          google_event_id: string | null
          id: string
          impact_score: number | null
          importance: number
          position: number
          project_id: string | null
          quadrant: Database["public"]["Enums"]["task_quadrant"]
          recurrence_parent_id: string | null
          recurrence_rule: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          tenant_id: string | null
          title: string
          updated_at: string
          urgency: number
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          estimated_time?: number | null
          google_event_id?: string | null
          id?: string
          impact_score?: number | null
          importance?: number
          position?: number
          project_id?: string | null
          quadrant?: Database["public"]["Enums"]["task_quadrant"]
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id?: string | null
          title: string
          updated_at?: string
          urgency?: number
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          estimated_time?: number | null
          google_event_id?: string | null
          id?: string
          impact_score?: number | null
          importance?: number
          position?: number
          project_id?: string | null
          quadrant?: Database["public"]["Enums"]["task_quadrant"]
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
          urgency?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invite_code: string
          invited_by: string
          invited_email: string | null
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["invite_status"]
          team_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          team_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_api_audit_log: {
        Row: {
          api_key_id: string | null
          created_at: string
          error: string | null
          id: string
          input_preview: Json | null
          status: string
          tenant_id: string
          tool: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input_preview?: Json | null
          status: string
          tenant_id: string
          tool?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input_preview?: Json | null
          status?: string
          tenant_id?: string
          tool?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_api_audit_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "tenant_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_api_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_api_keys: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          last_used_ip: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          last_used_ip?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          last_used_ip?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invites: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invite_code: string
          invited_by: string
          invited_email: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          status: Database["public"]["Enums"]["invite_status"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_mcp_settings: {
        Row: {
          created_at: string
          enabled: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_mcp_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_member_phones: {
        Row: {
          created_at: string
          id: string
          phone_number: string
          receive_reminders: boolean
          tenant_id: string
          updated_at: string
          user_id: string
          verification_code: string | null
          verification_expires_at: string | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          phone_number: string
          receive_reminders?: boolean
          tenant_id: string
          updated_at?: string
          user_id: string
          verification_code?: string | null
          verification_expires_at?: string | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          phone_number?: string
          receive_reminders?: boolean
          tenant_id?: string
          updated_at?: string
          user_id?: string
          verification_code?: string | null
          verification_expires_at?: string | null
          verified?: boolean
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_whatsapp_connections: {
        Row: {
          created_at: string
          created_by: string
          daily_report_enabled: boolean
          default_sender: boolean
          id: string
          instance_name: string
          phone_number: string | null
          qr_code: string | null
          reminders_enabled: boolean
          status: string
          tenant_id: string
          timezone: string
          updated_at: string
          weekly_report_enabled: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          daily_report_enabled?: boolean
          default_sender?: boolean
          id?: string
          instance_name: string
          phone_number?: string | null
          qr_code?: string | null
          reminders_enabled?: boolean
          status?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
          weekly_report_enabled?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          daily_report_enabled?: boolean
          default_sender?: boolean
          id?: string
          instance_name?: string
          phone_number?: string | null
          qr_code?: string | null
          reminders_enabled?: boolean
          status?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
          weekly_report_enabled?: boolean
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string
          created_by: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          badge_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          badge_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          badge_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_reminder_preferences: {
        Row: {
          auto_due_1h: boolean
          auto_due_d1: boolean
          auto_due_now: boolean
          auto_start: boolean
          created_at: string
          default_channels: Database["public"]["Enums"]["reminder_channel"][]
          default_recipients: Database["public"]["Enums"]["reminder_recipient"][]
          id: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_due_1h?: boolean
          auto_due_d1?: boolean
          auto_due_now?: boolean
          auto_start?: boolean
          created_at?: string
          default_channels?: Database["public"]["Enums"]["reminder_channel"][]
          default_recipients?: Database["public"]["Enums"]["reminder_recipient"][]
          id?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_due_1h?: boolean
          auto_due_d1?: boolean
          auto_due_now?: boolean
          auto_start?: boolean
          created_at?: string
          default_channels?: Database["public"]["Enums"]["reminder_channel"][]
          default_recipients?: Database["public"]["Enums"]["reminder_recipient"][]
          id?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_chat_history: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          accept_messages_from: string
          created_at: string
          daily_report_enabled: boolean
          id: string
          instance_name: string
          phone_number: string | null
          qr_code: string | null
          reminder_times: string
          reminders_enabled: boolean
          report_time: string | null
          status: string
          timezone: string
          updated_at: string
          user_id: string
          weekly_report_day: number
          weekly_report_enabled: boolean
          weekly_report_time: string | null
        }
        Insert: {
          accept_messages_from?: string
          created_at?: string
          daily_report_enabled?: boolean
          id?: string
          instance_name: string
          phone_number?: string | null
          qr_code?: string | null
          reminder_times?: string
          reminders_enabled?: boolean
          report_time?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          user_id: string
          weekly_report_day?: number
          weekly_report_enabled?: boolean
          weekly_report_time?: string | null
        }
        Update: {
          accept_messages_from?: string
          created_at?: string
          daily_report_enabled?: boolean
          id?: string
          instance_name?: string
          phone_number?: string | null
          qr_code?: string | null
          reminder_times?: string
          reminders_enabled?: boolean
          report_time?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          weekly_report_day?: number
          weekly_report_enabled?: boolean
          weekly_report_time?: string | null
        }
        Relationships: []
      }
      whatsapp_processed_messages: {
        Row: {
          instance_name: string
          message_id: string
          processed_at: string | null
        }
        Insert: {
          instance_name: string
          message_id: string
          processed_at?: string | null
        }
        Update: {
          instance_name?: string
          message_id?: string
          processed_at?: string | null
        }
        Relationships: []
      }
      whatsapp_sent_reminders: {
        Row: {
          id: string
          reminder_type: string
          sent_at: string | null
          task_id: string
          user_id: string
        }
        Insert: {
          id?: string
          reminder_type: string
          sent_at?: string | null
          task_id: string
          user_id: string
        }
        Update: {
          id?: string
          reminder_type?: string
          sent_at?: string | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sent_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      award_badge_if_earned: {
        Args: { _badge_id: string; _user_id: string }
        Returns: boolean
      }
      compute_reminder_scheduled_at: {
        Args: {
          _due: string
          _kind: Database["public"]["Enums"]["reminder_kind"]
          _start: string
        }
        Returns: string
      }
      expand_task_reminder: {
        Args: { _reminder_id: string }
        Returns: undefined
      }
      get_team_role: {
        Args: { _team_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["team_role"]
      }
      get_tenant_role: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      get_user_email: { Args: never; Returns: string }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_task_shared_with: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_admin: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      sync_task_auto_reminders: {
        Args: { _task_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "member" | "super_admin"
      delegation_status: "pending" | "accepted" | "completed" | "rejected"
      invite_status: "pending" | "accepted" | "expired" | "cancelled"
      reclassification_status: "pending" | "accepted" | "rejected" | "expired"
      reminder_channel:
        | "in_app"
        | "browser"
        | "whatsapp_personal"
        | "whatsapp_tenant"
        | "email"
      reminder_kind:
        | "due_d1"
        | "due_1h"
        | "due_now"
        | "start_now"
        | "start_5min"
        | "custom"
        | "daily_summary"
        | "weekly_plan"
      reminder_recipient: "creator" | "assignee" | "shared"
      scheduled_reminder_status:
        | "pending"
        | "sent"
        | "failed"
        | "skipped"
        | "cancelled"
      share_permission: "view" | "edit"
      task_quadrant: "do" | "schedule" | "delegate" | "eliminate"
      task_status: "pending" | "in_progress" | "completed" | "eliminated"
      team_role: "admin" | "manager" | "member"
      tenant_role: "owner" | "admin" | "member" | "guest"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member", "super_admin"],
      delegation_status: ["pending", "accepted", "completed", "rejected"],
      invite_status: ["pending", "accepted", "expired", "cancelled"],
      reclassification_status: ["pending", "accepted", "rejected", "expired"],
      reminder_channel: [
        "in_app",
        "browser",
        "whatsapp_personal",
        "whatsapp_tenant",
        "email",
      ],
      reminder_kind: [
        "due_d1",
        "due_1h",
        "due_now",
        "start_now",
        "start_5min",
        "custom",
        "daily_summary",
        "weekly_plan",
      ],
      reminder_recipient: ["creator", "assignee", "shared"],
      scheduled_reminder_status: [
        "pending",
        "sent",
        "failed",
        "skipped",
        "cancelled",
      ],
      share_permission: ["view", "edit"],
      task_quadrant: ["do", "schedule", "delegate", "eliminate"],
      task_status: ["pending", "in_progress", "completed", "eliminated"],
      team_role: ["admin", "manager", "member"],
      tenant_role: ["owner", "admin", "member", "guest"],
    },
  },
} as const
