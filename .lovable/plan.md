

# Correção: Assistente respondendo mensagens para outros contatos

## Problema

O filtro atual (linha 610) verifica apenas `fromMe === true`. Porém, **toda mensagem enviada do telefone do usuário** tem `fromMe: true` — seja para si mesmo ou para qualquer outro contato. O webhook processa e responde a todas elas.

## Causa raiz

Na Evolution API, o campo `msgData.key.remoteJid` indica o destinatário/remetente da conversa:
- Mensagem para si mesmo: `remoteJid` = número do próprio usuário (ex: `5511943246689@s.whatsapp.net`)
- Mensagem para outro contato: `remoteJid` = número do outro contato

O código **não verifica o `remoteJid`**, apenas o `fromMe`.

## Solução

Quando `accept_messages_from = 'self_only'`, adicionar uma verificação de que o `remoteJid` corresponde ao número do usuário cadastrado em `whatsapp_connections.phone_number`. Se não corresponder, ignorar a mensagem.

## Mudança

### `supabase/functions/whatsapp-webhook/index.ts`

Após buscar a conexão (linha 601-607), antes do filtro `acceptFrom` (linha 609-613):

```typescript
const acceptFrom = conn.accept_messages_from || 'self_only';

if (acceptFrom === 'self_only') {
  // Must be fromMe AND the conversation must be with self (remoteJid = own number)
  const remoteJid = msgData.key?.remoteJid || '';
  const ownNumber = (conn.phone_number || '').replace(/\D/g, '');
  const remoteNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');

  if (!fromMe || !ownNumber || remoteNumber !== ownNumber) {
    console.log(`Ignored: self_only mode, fromMe=${fromMe}, remote=${remoteNumber}, own=${ownNumber}`);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
}
```

Isso garante que:
1. Apenas mensagens enviadas pelo próprio usuário (`fromMe`) são consideradas
2. A conversa deve ser consigo mesmo (`remoteJid` = próprio número)
3. Mensagens para outros contatos são completamente ignoradas

### Arquivo modificado
| Arquivo | Ação |
|---------|------|
| `supabase/functions/whatsapp-webhook/index.ts` | Substituir filtro nas linhas 609-613 |

