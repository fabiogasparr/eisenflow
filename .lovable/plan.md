

# Correção do Loop Infinito no WhatsApp Webhook

## Problema

O bot está gerando mensagens em loop infinito. O fluxo é:

```text
1. Usuário envia mensagem para si mesmo
2. Webhook recebe (fromMe=true) → processa → envia resposta via API
3. A resposta enviada pelo bot TAMBÉM é um MESSAGES_UPSERT com fromMe=true
4. Webhook recebe a resposta do bot → processa como nova mensagem → envia outra resposta
5. Repete infinitamente
```

Como `accept_messages_from = 'self_only'` e as respostas do bot são enviadas pelo mesmo número (`fromMe=true`), o webhook não consegue distinguir entre mensagens do usuário e respostas do próprio bot.

## Solução

Duas camadas de proteção:

### 1. Deduplicação por Message ID

Criar uma tabela `whatsapp_processed_messages` para rastrear IDs de mensagens já processadas. Cada evento MESSAGES_UPSERT tem um `msgData.key.id` único. Se já foi processado, ignorar.

### 2. Detecção de mensagens enviadas via API

A Evolution API marca mensagens enviadas via API com campos específicos (ex: `msgData.key.id` começa com padrões específicos, ou `msgData.messageTimestamp` é muito recente comparado ao processamento). A forma mais robusta é verificar se o `remoteJid` do destinatário é o próprio número do bot — nesse caso, apenas processar se NÃO for uma mensagem já presente na tabela de dedup.

### 3. Rate limiting por usuário

Adicionar um check temporal: ignorar mensagens do mesmo usuário se a última foi processada há menos de 3 segundos.

## Mudanças

### Migração SQL — tabela de dedup

```sql
CREATE TABLE public.whatsapp_processed_messages (
  message_id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-cleanup de registros antigos (>24h)
CREATE INDEX idx_wpm_processed_at ON public.whatsapp_processed_messages(processed_at);
```

### Edge Function `whatsapp-webhook/index.ts`

No handler de MESSAGES_UPSERT (linha ~567), antes de processar:

1. Extrair `messageId = msgData.key?.id`
2. Verificar se já existe em `whatsapp_processed_messages` — se sim, ignorar
3. Inserir o `messageId` na tabela antes de processar
4. Adicionar check temporal: buscar último registro do usuário e ignorar se < 3 segundos
5. Adicionar cleanup periódico (deletar registros > 24h)

### Arquivos modificados

| Arquivo | Ação |
|---------|------|
| Migração SQL | Tabela `whatsapp_processed_messages` |
| `supabase/functions/whatsapp-webhook/index.ts` | Dedup + rate limit antes de processar mensagem |

