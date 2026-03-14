

## Diagnóstico: Webhook WhatsApp não recebe mensagens

### Problema identificado
A conexão WhatsApp está ativa no banco (status `connected`, telefone cadastrado), mas **a função `whatsapp-webhook` não registra nenhum log** — ou seja, a Evolution API não está chamando o webhook.

### Causa provável
O webhook foi registrado na Evolution API apenas no momento do `whatsapp-connect`, mas pode ter sido perdido (restart da instância, expiração, ou a instância foi recriada sem re-registrar). A Evolution API não persiste webhooks automaticamente em todos os cenários.

### Solução proposta

1. **Criar um endpoint de re-registro de webhook** — Adicionar uma nova edge function `whatsapp-reregister-webhook` (ou incluir no `whatsapp-status`) que force o re-registro do webhook na Evolution API para a instância do usuário.

2. **Adicionar re-registro automático no `whatsapp-status`** — Quando o frontend checa o status da conexão, também re-registrar o webhook na Evolution API para garantir que está ativo. Isso resolve o problema silenciosamente.

3. **Adicionar botão "Reconectar Webhook"** na página de configurações do WhatsApp para o usuário forçar o re-registro quando necessário.

### Implementação técnica

**Arquivo: `supabase/functions/whatsapp-status/index.ts`**
- Ao verificar o status, também chamar `EVOLUTION_API_URL/webhook/set/{instanceName}` com a URL do webhook para garantir que está registrado.

**Arquivo: `src/pages/SettingsPage.tsx`**
- Adicionar botão "Reconectar" que chama `whatsapp-status` forçando re-registro.

### Mudanças
- `supabase/functions/whatsapp-status/index.ts` — adicionar lógica de re-registro do webhook
- `src/pages/SettingsPage.tsx` — botão opcional de reconectar webhook (menor prioridade)

