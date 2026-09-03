export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'eliminated';
export type RecurrenceRule = 'daily' | 'weekly' | 'monthly';

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  urgency: number;
  importance: number;
  quadrant: Quadrant;
  due_date: string | null;
  estimated_time: number | null;
  status: TaskStatus;
  project_id: string | null;
  created_by: string;
  assigned_to: string | null;
  tags: string[];
  impact_score: number;
  position: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  recurrence_parent_id: string | null;
  google_event_id: string | null;
  /** Tenant dono da tarefa. Existia no Postgres e faltava neste tipo. */
  tenant_id: string | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  due_date?: string;
  estimated_time?: number;
  project_id?: string;
  assigned_to?: string;
  tags?: string[];
  quadrant?: Quadrant;
  urgency?: number;
  importance?: number;
  recurrence_rule?: RecurrenceRule;
}

export const QUADRANT_CONFIG = {
  do: {
    labelKey: 'doNow' as const,
    descKey: 'doNowDesc' as const,
    colorClass: 'quadrant-do',
    bgClass: 'quadrant-do-bg',
    emoji: '🟩',
    row: 0,
    col: 0,
  },
  schedule: {
    labelKey: 'schedule' as const,
    descKey: 'scheduleDesc' as const,
    colorClass: 'quadrant-schedule',
    bgClass: 'quadrant-schedule-bg',
    emoji: '🟧',
    row: 0,
    col: 1,
  },
  delegate: {
    labelKey: 'delegate' as const,
    descKey: 'delegateDesc' as const,
    colorClass: 'quadrant-delegate',
    bgClass: 'quadrant-delegate-bg',
    emoji: '🟦',
    row: 1,
    col: 0,
  },
  eliminate: {
    labelKey: 'eliminate' as const,
    descKey: 'eliminateDesc' as const,
    colorClass: 'quadrant-eliminate',
    bgClass: 'quadrant-eliminate-bg',
    emoji: '🟥',
    row: 1,
    col: 1,
  },
} as const;
