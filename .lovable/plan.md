

## Diagnóstico

Identifiquei **3 problemas** que explicam por que o lembrete WhatsApp não é enviado:

### Problema 1: Cron job nunca foi criado
As migrações só habilitam as extensões `pg_cron` e `pg_net`, mas **nunca agendam o job** que chama a edge function `whatsapp-deadline-reminders`. Além disso, `pg_cron` pode não funcionar no Lovable Cloud.

### Problema 2: Bug de closure no `useReminders`
A função `sendWhatsAppReminder` **não está na lista de dependências** do `useCallback` de `checkTasks` (linha 121). Isso significa que `checkTasks` usa uma referência obsoleta e o envio nunca executa de fato.

### Problema 3: Janela de detecção muito estreita
O cliente verifica a cada 30 segundos com uma janela de 2 minutos. Se o app não estiver aberto no momento exato, o lembrete é perdido para sempre.

---

## Plano de Correção

### 1. Corrigir `src/hooks/useReminders.ts`
- Adicionar `sendWhatsAppReminder` à lista de dependências do `checkTasks`
- Ampliar a janela de detecção de 2 minutos para **10 minutos** para ser mais tolerante

### 2. Adicionar chamada periódica à edge function no cliente
Em vez de depender de `pg_cron` (que pode não funcionar), chamar `whatsapp-deadline-reminders` diretamente do cliente a cada 15 minutos quando o app está aberto. Isso garante que o envio aconteça via servidor também.

Adicionar no `useReminders.ts`:
```typescript
// A cada 15min, dispara a edge function de lembretes
useEffect(() => {
  const callDeadlineReminders = async () => {
    try {
      await supabase.functions.invoke('whatsapp-deadline-reminders');
    } catch {}
  };
  callDeadlineReminders();
  const interval = setInterval(callDeadlineReminders, 15 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

### 3. Adicionar logs na edge function
Adicionar `console.log` com detalhes (conexões encontradas, tarefas encontradas, erros da Evolution API) para facilitar depuração futura.

### Arquivos modificados
- `src/hooks/useReminders.ts` — fix deps + chamada periódica à edge function + janela maior
- `supabase/functions/whatsapp-deadline-reminders/index.ts` — logs detalhados + capturar resposta da Evolution API

