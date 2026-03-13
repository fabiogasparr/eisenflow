

## Problema

Quando o QR Code é escaneado, a Evolution API envia um evento `CONNECTION_UPDATE` via webhook para a edge function `whatsapp-webhook`. Porém, os logs mostram que **nenhuma requisição chegou** ao webhook. Existem dois problemas prováveis:

1. **A URL do webhook não inclui a apikey**: A Evolution API faz um POST direto para a URL configurada, sem incluir headers de autenticação do backend. Mesmo com `verify_jwt = false`, o request pode estar falhando por outro motivo.

2. **O formato do evento pode não bater**: A Evolution API v2 pode enviar o evento com estrutura diferente do que o webhook espera (ex: `event` pode estar em campo diferente, ou o body ter formato distinto).

## Correções

### 1. Melhorar o webhook URL com apikey como query param
No `whatsapp-connect/index.ts`, ao configurar o webhook na Evolution API, incluir a apikey do Supabase como query param para garantir que a requisição chegue:

```typescript
url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`
```
Isso já está correto e `verify_jwt = false` deveria permitir. O problema pode ser outro.

### 2. Adicionar logs detalhados no webhook para debugging
Adicionar `console.log` no início do webhook para registrar todo body recebido, facilitando diagnóstico.

### 3. Tratar mais formatos de evento CONNECTION_UPDATE
A Evolution API v2 pode enviar o evento em formatos alternativos. Ampliar a detecção para cobrir variações:
- `body.event === 'connection.update'` (lowercase com ponto)
- `body.event === 'CONNECTION_UPDATE'`  
- Verificar `body.data?.instance?.state`

### 4. Adicionar endpoint de fallback manual
Criar um mecanismo para o frontend verificar manualmente o status da instância na Evolution API (via a edge function), para que quando o polling detecte que a conexão foi estabelecida, atualize o banco. Isso resolve o problema mesmo que o webhook nunca chegue.

Concretamente: modificar a lógica de polling no `useWhatsApp` para chamar uma nova edge function (ou modificar `whatsapp-connect`) que checa o status atual da instância na Evolution API e atualiza o banco se já estiver conectada.

### Plano de implementação

1. **Modificar `whatsapp-webhook/index.ts`**: Adicionar logs e ampliar detecção de eventos
2. **Criar `whatsapp-status` edge function**: Nova function que consulta o status da instância na Evolution API e atualiza o banco — será chamada pelo polling do frontend
3. **Atualizar `useWhatsApp.ts`**: O polling (quando status é `qr_pending`) chama a nova function `whatsapp-status` em vez de apenas re-fetch do banco
4. **Atualizar `supabase/config.toml`**: Registrar a nova function

