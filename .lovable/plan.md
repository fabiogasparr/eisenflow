

# Adicionar Timezone do Usuário aos Lembretes

## Problema

Os horários de lembrete (`reminder_times`) são comparados com a hora UTC do servidor. Se o usuário está em UTC-3 (São Paulo) e configura lembrete para 08:00, o sistema compara com 08:00 UTC — que é 05:00 no horário local. Os lembretes chegam no horário errado.

## Solução

### 1. Migração SQL — adicionar coluna `timezone`

Adicionar `timezone text NOT NULL DEFAULT 'America/Sao_Paulo'` à tabela `whatsapp_connections`. Usar timezone IANA (ex: `America/Sao_Paulo`, `America/New_York`).

### 2. Edge Function — converter hora UTC para hora local

Na `whatsapp-deadline-reminders/index.ts`, em vez de comparar `currentHour:currentMinute` (UTC) direto com `reminder_times`, converter a hora atual para o timezone do usuário antes de comparar.

```typescript
// Converter UTC para hora local do usuário
const userNow = new Date(now.toLocaleString('en-US', { timeZone: conn.timezone || 'America/Sao_Paulo' }));
const userHour = userNow.getHours();
const userMinute = userNow.getMinutes();
```

### 3. Hook `useWhatsApp` — adicionar `timezone` ao tipo

Incluir `timezone: string` no `WhatsAppConnection` interface.

### 4. UI em SettingsPage — seletor de timezone

Adicionar um `<Select>` com os fusos horários mais comuns do Brasil e internacionais, logo abaixo do editor de horários de lembrete. Detectar automaticamente o timezone do navegador (`Intl.DateTimeFormat().resolvedOptions().timeZone`) como valor padrão.

## Arquivos modificados

| Arquivo | Ação |
|---------|------|
| Migração SQL | Coluna `timezone` em `whatsapp_connections` |
| `src/hooks/useWhatsApp.ts` | Campo `timezone` no tipo |
| `src/pages/SettingsPage.tsx` | Seletor de fuso horário |
| `supabase/functions/whatsapp-deadline-reminders/index.ts` | Converter UTC → timezone do usuário |

