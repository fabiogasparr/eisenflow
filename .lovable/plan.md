

# Sons distintos para cada ação no Modo Foco

## Conceito

Criar uma biblioteca de sons sintetizados via Web Audio API, cada um com personalidade sonora única que remete ao contexto da Matriz de Eisenhower + Pomodoro:

| Ação | Som | Descrição |
|------|-----|-----------|
| **Iniciar tarefa** | Ascendente energético (3 notas subindo) | Sensação de "partiu!" |
| **Pausar** | Descendente suave (2 notas caindo) | Sensação de desaceleração |
| **Retomar** | Duplo beep curto | Sensação de "de volta" |
| **Fim do Pomodoro (foco)** | Fanfarra de conquista (4 notas em acorde maior) | Celebração — ciclo completo |
| **Fim da pausa** | Sino suave + nota crescente | "Hora de voltar ao foco" |
| **Completar tarefa** | Acorde triunfante (5 notas) | Recompensa máxima |

## Alterações

### `src/components/FocusMode.tsx`
- Substituir `playNotificationSound` por um módulo de sons com funções nomeadas: `playStartSound`, `playPauseSound`, `playResumeSound`, `playPhaseEndSound`, `playCompleteSound`
- Cada função usa combinações diferentes de frequências, durações e envelopes (gain ramp)
- Chamar o som correto em cada ponto:
  - `handleStartTask` → `playStartSound()`
  - `handlePauseResume` → `playPauseSound()` ou `playResumeSound()` conforme estado
  - `handlePhaseEnd` → `playPhaseEndSound(phase)` (som diferente para fim de foco vs fim de pausa)
  - `handleCompleteTask` → `playCompleteSound()`

Nenhuma alteração no banco ou em outros arquivos.

