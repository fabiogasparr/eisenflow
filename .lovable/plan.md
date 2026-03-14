

## Plano: Auto-configurar webhook após escaneamento do QR

### Problema
O webhook só é registrado na Evolution API quando uma **nova instância** é criada no `whatsapp-connect`. Quando a instância já existe (reconexão), o webhook **não é re-registrado**. E no `whatsapp-status`, quando detecta que a conexão foi estabelecida, também **não configura o webhook**. Resultado: a Evolution API não sabe para onde enviar as mensagens recebidas.

### Correções

#### 1. `whatsapp-status/index.ts`
Quando detectar que o estado mudou para `connected`, registrar automaticamente o webhook na Evolution API antes de atualizar o banco. Isso garante que **toda vez** que o QR for escaneado com sucesso, o webhook é configurado.

```typescript
// Após detectar instanceState === 'open' || 'connected':
await fetch(`${EVOLUTION_API_URL}/webhook/set/${conn.instance_name}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
  body: JSON.stringify({
    url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`,
    webhook_by_events: true,
    webhook_base64: false,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
  }),
})
```

#### 2. `whatsapp-connect/index.ts`
Adicionar registro do webhook também no branch de "instância já existe" (linhas 56-83), que atualmente só pega o QR mas não configura o webhook.

#### 3. Correção do `ownerJid` no `whatsapp-status`
O campo `phoneNumber` usa `instance?.owner` mas deveria usar `instance?.ownerJid` (como já corrigido no webhook e deadline-reminders).

### Arquivos modificados
- `supabase/functions/whatsapp-status/index.ts` — registrar webhook ao detectar conexão + fix ownerJid
- `supabase/functions/whatsapp-connect/index.ts` — registrar webhook no branch de reconexão

