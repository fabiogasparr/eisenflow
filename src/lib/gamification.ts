export interface Badge {
  id: string;
  icon: string;
  labelPt: string;
  labelEn: string;
  descPt: string;
  descEn: string;
  condition: (stats: GamificationStats) => boolean;
}

export interface GamificationStats {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  total_tasks_completed: number;
  total_tasks_eliminated: number;
  total_tasks_delegated: number;
  total_focus_minutes: number;
  total_pomodoros: number;
  life_score: number;
  level: number;
  xp: number;
}

export const BADGES: Badge[] = [
  {
    id: 'first_task',
    icon: '🎯',
    labelPt: 'Primeira Tarefa',
    labelEn: 'First Task',
    descPt: 'Completou sua primeira tarefa',
    descEn: 'Completed your first task',
    condition: (s) => s.total_tasks_completed >= 1,
  },
  {
    id: 'task_master_10',
    icon: '⚡',
    labelPt: 'Produtivo',
    labelEn: 'Productive',
    descPt: 'Completou 10 tarefas',
    descEn: 'Completed 10 tasks',
    condition: (s) => s.total_tasks_completed >= 10,
  },
  {
    id: 'task_master_50',
    icon: '🔥',
    labelPt: 'Máquina de Tarefas',
    labelEn: 'Task Machine',
    descPt: 'Completou 50 tarefas',
    descEn: 'Completed 50 tasks',
    condition: (s) => s.total_tasks_completed >= 50,
  },
  {
    id: 'task_master_100',
    icon: '💎',
    labelPt: 'Lenda da Produtividade',
    labelEn: 'Productivity Legend',
    descPt: 'Completou 100 tarefas',
    descEn: 'Completed 100 tasks',
    condition: (s) => s.total_tasks_completed >= 100,
  },
  {
    id: 'streak_3',
    icon: '🔥',
    labelPt: 'Sequência de 3',
    labelEn: '3-Day Streak',
    descPt: '3 dias consecutivos produtivos',
    descEn: '3 consecutive productive days',
    condition: (s) => s.longest_streak >= 3,
  },
  {
    id: 'streak_7',
    icon: '🌟',
    labelPt: 'Semana Perfeita',
    labelEn: 'Perfect Week',
    descPt: '7 dias consecutivos produtivos',
    descEn: '7 consecutive productive days',
    condition: (s) => s.longest_streak >= 7,
  },
  {
    id: 'streak_30',
    icon: '👑',
    labelPt: 'Mês Imparável',
    labelEn: 'Unstoppable Month',
    descPt: '30 dias consecutivos produtivos',
    descEn: '30 consecutive productive days',
    condition: (s) => s.longest_streak >= 30,
  },
  {
    id: 'eliminator_5',
    icon: '🗑️',
    labelPt: 'Eliminador',
    labelEn: 'Eliminator',
    descPt: 'Eliminou 5 tarefas desnecessárias',
    descEn: 'Eliminated 5 unnecessary tasks',
    condition: (s) => s.total_tasks_eliminated >= 5,
  },
  {
    id: 'delegator_5',
    icon: '🤝',
    labelPt: 'Delegador',
    labelEn: 'Delegator',
    descPt: 'Delegou 5 tarefas',
    descEn: 'Delegated 5 tasks',
    condition: (s) => s.total_tasks_delegated >= 5,
  },
  {
    id: 'focus_60',
    icon: '🧘',
    labelPt: 'Focado',
    labelEn: 'Focused',
    descPt: '60 minutos em modo foco',
    descEn: '60 minutes in focus mode',
    condition: (s) => s.total_focus_minutes >= 60,
  },
  {
    id: 'focus_300',
    icon: '🧠',
    labelPt: 'Mestre do Foco',
    labelEn: 'Focus Master',
    descPt: '5 horas em modo foco',
    descEn: '5 hours in focus mode',
    condition: (s) => s.total_focus_minutes >= 300,
  },
  {
    id: 'level_5',
    icon: '🏅',
    labelPt: 'Nível 5',
    labelEn: 'Level 5',
    descPt: 'Alcançou nível 5',
    descEn: 'Reached level 5',
    condition: (s) => s.level >= 5,
  },
  {
    id: 'level_10',
    icon: '🏆',
    labelPt: 'Nível 10',
    labelEn: 'Level 10',
    descPt: 'Alcançou nível 10',
    descEn: 'Reached level 10',
    condition: (s) => s.level >= 10,
  },
  {
    id: 'score_50',
    icon: '📊',
    labelPt: 'Vida Equilibrada',
    labelEn: 'Balanced Life',
    descPt: 'Score de vida produtiva acima de 50',
    descEn: 'Productive life score above 50',
    condition: (s) => s.life_score >= 50,
  },
  {
    id: 'score_80',
    icon: '🚀',
    labelPt: 'Alta Performance',
    labelEn: 'High Performer',
    descPt: 'Score de vida produtiva acima de 80',
    descEn: 'Productive life score above 80',
    condition: (s) => s.life_score >= 80,
  },
];

export function calculateLevel(xp: number): number {
  // Each level requires progressively more XP
  // Level 1: 0, Level 2: 100, Level 3: 250, Level 4: 450...
  let level = 1;
  let threshold = 0;
  while (xp >= threshold + level * 100) {
    threshold += level * 100;
    level++;
  }
  return level;
}

export function xpForNextLevel(level: number): number {
  return level * 100;
}

export function currentLevelXp(xp: number, level: number): number {
  let threshold = 0;
  for (let i = 1; i < level; i++) {
    threshold += i * 100;
  }
  return xp - threshold;
}

export function calculateLifeScore(stats: GamificationStats): number {
  // Score 0-100 based on productivity balance
  const completionScore = Math.min(stats.total_tasks_completed * 2, 30);
  const streakScore = Math.min(stats.current_streak * 5, 25);
  const eliminationScore = Math.min(stats.total_tasks_eliminated * 3, 15);
  const delegationScore = Math.min(stats.total_tasks_delegated * 3, 15);
  const focusScore = Math.min(stats.total_focus_minutes / 10, 15);
  return Math.min(Math.round(completionScore + streakScore + eliminationScore + delegationScore + focusScore), 100);
}

// XP rewards
export const XP_REWARDS = {
  TASK_COMPLETED: 15,
  TASK_ELIMINATED: 5,
  TASK_DELEGATED: 8,
  STREAK_DAY: 10,
  FOCUS_MINUTE: 1,
  POMODORO_COMPLETED: 20,
};
