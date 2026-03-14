

# Configurar agendamento de mensagens via pg_cron

## Situação atual
- `whatsapp-deadline-reminders` é chamado pelo cliente (browser) a cada 15 min — funciona apenas enquanto o app está aberto
- `whatsapp-report` (diário e semanal) **não tem nenhum agendamento** — nunca é chamado automaticamente

## Plano

### 1. Habilitar extensões pg_cron e pg_net
Executar SQL para ativar as extensões necessárias para agendamento server-side.

### 2. Criar 3 cron jobs

| Job | Schedule | Edge Function | Body |
|-----|----------|---------------|------|
| Lembretes de prazo | A cada 15 min | `whatsapp-deadline-reminders` | `{}` |
| Relatório diário | A cada hora (a função filtra pelo horário do usuário) | `whatsapp-report` | `{"type":"daily"}` |
| Relatório semanal | A cada hora (a função filtra pelo dia/hora) | `whatsapp-report` | `{"type":"weekly"}` |

Os reports rodam a cada hora porque a função já faz a filtragem interna comparando o `report_time` / `weekly_report_time` do usuário com a hora atual BRT.

### 3. Remover chamada client-side redundante
Remover o `useEffect` que chama `whatsapp-deadline-reminders` do `src/hooks/useReminders.ts`, já que o pg_cron cuidará disso.

## Arquivos
- SQL (via insert tool, não migration): criar os cron jobs
- `src/hooks/useReminders.ts`: remover chamada client-side do deadline-reminders

