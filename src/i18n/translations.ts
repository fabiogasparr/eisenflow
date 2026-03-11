export type Language = 'pt-BR' | 'en';

export const translations = {
  'pt-BR': {
    // Nav
    matrix: 'Matriz',
    weeklyPlanning: 'Planejamento Semanal',
    projects: 'Projetos',
    metrics: 'Métricas',
    gamification: 'Conquistas',
    teams: 'Times',
    settings: 'Configurações',
    
    // Quadrants
    doNow: 'Fazer Agora',
    doNowDesc: 'Urgente e Importante',
    schedule: 'Agendar',
    scheduleDesc: 'Importante, não Urgente',
    delegate: 'Delegar',
    delegateDesc: 'Urgente, não Importante',
    eliminate: 'Eliminar',
    eliminateDesc: 'Nem Urgente, nem Importante',
    
    // Actions
    addTask: 'Nova Tarefa',
    save: 'Salvar',
    cancel: 'Cancelar',
    delete: 'Excluir',
    edit: 'Editar',
    complete: 'Concluir',
    start: 'Iniciar',
    delegateAction: 'Delegar',
    reschedule: 'Reagendar',
    eliminateAction: 'Eliminar',
    
    // Task form
    taskTitle: 'Título',
    taskDescription: 'Descrição',
    taskDueDate: 'Prazo',
    taskProject: 'Projeto',
    taskTags: 'Tags',
    taskEstimatedTime: 'Tempo estimado (min)',
    taskUrgency: 'Urgência',
    taskImportance: 'Importância',
    
    // AI
    aiSuggestion: 'Sugestão da IA',
    aiClassifying: 'Classificando com IA...',
    acceptSuggestion: 'Aceitar',
    adjustManually: 'Ajustar manualmente',
    
    // Auth
    login: 'Entrar',
    signup: 'Criar conta',
    logout: 'Sair',
    email: 'Email',
    password: 'Senha',
    displayName: 'Nome',
    forgotPassword: 'Esqueci minha senha',
    resetPassword: 'Redefinir senha',
    noAccount: 'Não tem conta?',
    hasAccount: 'Já tem conta?',
    
    // Metrics
    tasksCompleted: 'Tarefas concluídas',
    tasksEliminated: 'Tarefas eliminadas',
    tasksDelegated: 'Tarefas delegadas',
    timeInImportant: 'Tempo em tarefas importantes',
    productivityScore: 'Score de Produtividade',
    weeklyTrend: 'Tendência Semanal',
    byQuadrant: 'Por Quadrante',
    
    // General
    search: 'Buscar...',
    noTasks: 'Nenhuma tarefa',
    dragHint: 'Arraste para reclassificar',
    welcome: 'Bem-vindo ao EisenFlow',
    welcomeDesc: 'Priorize suas tarefas com a Matriz de Eisenhower',
    language: 'Idioma',
    urgent: 'Urgente',
    notUrgent: 'Não Urgente',
    important: 'Importante',
    notImportant: 'Não Importante',
    minutes: 'min',
    impact: 'Impacto',
    aiChat: 'Chat IA',
    aiChatDesc: 'Descreva tarefas em linguagem natural',
    aiChatWelcome: 'Como posso ajudar?',
    aiChatWelcomeDesc: 'Descreva um projeto ou tarefa e eu vou criar, classificar e atribuir automaticamente usando a Matriz de Eisenhower.',
    aiChatPlaceholder: 'Descreva uma tarefa ou projeto...',
    confirmTasks: 'Criar tarefas',
    tasksCreatedSuccess: 'Tarefas criadas com sucesso!',
  },
  en: {
    // Nav
    matrix: 'Matrix',
    weeklyPlanning: 'Weekly Planning',
    projects: 'Projects',
    metrics: 'Metrics',
    gamification: 'Achievements',
    teams: 'Teams',
    settings: 'Settings',
    
    // Quadrants
    doNow: 'Do Now',
    doNowDesc: 'Urgent and Important',
    schedule: 'Schedule',
    scheduleDesc: 'Important, not Urgent',
    delegate: 'Delegate',
    delegateDesc: 'Urgent, not Important',
    eliminate: 'Eliminate',
    eliminateDesc: 'Not Urgent, not Important',
    
    // Actions
    addTask: 'New Task',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    complete: 'Complete',
    start: 'Start',
    delegateAction: 'Delegate',
    reschedule: 'Reschedule',
    eliminateAction: 'Eliminate',
    
    // Task form
    taskTitle: 'Title',
    taskDescription: 'Description',
    taskDueDate: 'Due date',
    taskProject: 'Project',
    taskTags: 'Tags',
    taskEstimatedTime: 'Estimated time (min)',
    taskUrgency: 'Urgency',
    taskImportance: 'Importance',
    
    // AI
    aiSuggestion: 'AI Suggestion',
    aiClassifying: 'Classifying with AI...',
    acceptSuggestion: 'Accept',
    adjustManually: 'Adjust manually',
    
    // Auth
    login: 'Log in',
    signup: 'Sign up',
    logout: 'Log out',
    email: 'Email',
    password: 'Password',
    displayName: 'Name',
    forgotPassword: 'Forgot password',
    resetPassword: 'Reset password',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    
    // Metrics
    tasksCompleted: 'Tasks completed',
    tasksEliminated: 'Tasks eliminated',
    tasksDelegated: 'Tasks delegated',
    timeInImportant: 'Time on important tasks',
    productivityScore: 'Productivity Score',
    weeklyTrend: 'Weekly Trend',
    byQuadrant: 'By Quadrant',
    
    // General
    search: 'Search...',
    noTasks: 'No tasks',
    dragHint: 'Drag to reclassify',
    welcome: 'Welcome to EisenFlow',
    welcomeDesc: 'Prioritize your tasks with the Eisenhower Matrix',
    language: 'Language',
    urgent: 'Urgent',
    notUrgent: 'Not Urgent',
    important: 'Important',
    notImportant: 'Not Important',
    minutes: 'min',
    impact: 'Impact',
    aiChat: 'AI Chat',
    aiChatDesc: 'Describe tasks in natural language',
    aiChatWelcome: 'How can I help?',
    aiChatWelcomeDesc: 'Describe a project or task and I will automatically create, classify and assign using the Eisenhower Matrix.',
    aiChatPlaceholder: 'Describe a task or project...',
    confirmTasks: 'Create tasks',
    tasksCreatedSuccess: 'Tasks created successfully!',
  },
} as const;

export type TranslationKey = keyof typeof translations['en'];
