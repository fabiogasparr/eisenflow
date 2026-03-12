

# Pomodoro no Modo Foco

Excelente ideia. O Pomodoro encaixa perfeitamente no **Modo Foco** que já existe — ele já tem um timer e trabalha com tarefas do quadrante "Fazer Agora". A proposta é transformar o timer livre atual em um timer Pomodoro estruturado.

## Regras do Pomodoro

- **Foco**: 25 minutos de trabalho concentrado
- **Pausa curta**: 5 minutos após cada pomodoro
- **Pausa longa**: 15 minutos após 4 pomodoros consecutivos
- Contagem regressiva (ao invés do cronômetro crescente atual)
- Notificação sonora + visual ao final de cada ciclo
- Contador de pomodoros completados por tarefa e na sessão

## Onde colocar

O Pomodoro ficaria **dentro do Modo Foco** (`FocusMode.tsx`), que já é o lugar natural para execução focada. O timer atual seria substituído por um timer regressivo com fases (foco/pausa).

Nas **Configurações**, o usuário poderia personalizar os tempos (25/5/15) e ativar/desativar o Pomodoro (voltando ao timer livre se preferir).

## Mudanças

### 1. Configurações do Pomodoro
**`src/hooks/useCalendarSettings.ts`** → renomear ou expandir para `usePomodoroSettings` separado
- Novo hook `src/hooks/usePomodoroSettings.ts` com preferências em `localStorage`:
  - `enabled`: boolean (default true)
  - `focusDuration`: number em minutos (default 25)
  - `shortBreakDuration`: number (default 5)
  - `longBreakDuration`: number (default 15)
  - `longBreakInterval`: number (default 4)

### 2. Atualizar FocusMode
**`src/components/FocusMode.tsx`**:
- Substituir timer crescente por contagem regressiva
- Adicionar fases: `'focus' | 'short_break' | 'long_break'`
- Ao terminar fase de foco: tocar som, mostrar notificação, incrementar contador de pomodoros
- Ao terminar pausa: auto-iniciar próximo foco (ou aguardar clique)
- Exibir indicador visual de fase atual (cor diferente para foco vs pausa)
- Mostrar contador de pomodoros completados (tomates/círculos preenchidos)
- Botão "Pular Pausa" para quem quiser continuar direto

### 3. Configurações na SettingsPage
**`src/pages/SettingsPage.tsx`**:
- Novo card "Pomodoro" com inputs para personalizar durações
- Switch para ativar/desativar (quando desativado, volta ao timer livre)

### 4. Gamificação
- Registrar `recordAction('pomodoro')` a cada pomodoro completado (já existe infraestrutura)

### 5. Traduções
**`src/i18n/translations.ts`**:
- Chaves: `pomodoro`, `focusPhase`, `breakPhase`, `shortBreak`, `longBreak`, `pomodorosCompleted`, `skipBreak`

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/hooks/usePomodoroSettings.ts` | Criar |
| `src/components/FocusMode.tsx` | Editar — timer Pomodoro |
| `src/pages/SettingsPage.tsx` | Editar — card Pomodoro |
| `src/i18n/translations.ts` | Editar — novas chaves |

