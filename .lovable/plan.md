

# Integração WhatsApp via Evolution API (Multi-Tenant)

## Visão Geral

Cada usuário pode conectar seu próprio WhatsApp escaneando um QR code. Após conectado, pode:
- **Receber lembretes** automáticos de tarefas via WhatsApp (opt-in)
- **Enviar comandos** por WhatsApp para criar/editar/mover tarefas
- **Receber relatórios** formatados com layout bonito

## Arquitetura

```text
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Frontend   │────▶│  Edge Functions   │────▶│  Evolution API   │
│  (Settings) │     │                  │     │  (self-hosted)   │
│  QR Code    │◀────│  whatsapp-*      │◀────│  Webhook ──────▶ │
└─────────────┘     └──────────────────┘     └──────────────────┘
```

## Pré-requisito: Evolution API URL + Key

O usuário precisa fornecer a URL da instância Evolution API e a API Key global. Esses dados ficam como secrets do projeto.

## Database

### Nova tabela `whatsapp_connections`
```sql
CREATE TABLE whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  instance_name text NOT NULL,       -- nome único da instância no Evolution
  phone_number text,                 -- preenchido após conexão
  status text NOT NULL DEFAULT 'disconnected', -- disconnected, qr_pending, connected
  qr_code text,                      -- base64 do QR temporário
  reminders_enabled boolean NOT NULL DEFAULT false,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  report_time time DEFAULT '08:00',  -- horário do relatório diário
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: usuário vê/edita apenas sua própria conexão
```

## Edge Functions

| Function | Responsabilidade |
|----------|-----------------|
| `whatsapp-connect` | Cria instância no Evolution API, retorna QR code |
| `whatsapp-disconnect` | Remove instância do Evolution API |
| `whatsapp-webhook` | Recebe mensagens do Evolution API, processa comandos |
| `whatsapp-send` | Envia mensagem/lembrete/relatório para um número |
| `whatsapp-report` | Gera e envia relatório diário formatado (chamado via cron) |

## Fluxo de Conexão

1. Usuário vai em **Configurações → WhatsApp**
2. Clica "Conectar WhatsApp"
3. Edge function `whatsapp-connect` cria instância no Evolution API
4. QR code é exibido na tela
5. Usuário escaneia com WhatsApp
6. Webhook do Evolution confirma conexão → status = `connected`
7. Usuário ativa lembretes e/ou relatórios

## Comandos WhatsApp (Inbound)

Mensagens enviadas para o próprio número são processadas pelo webhook:

| Comando | Ação |
|---------|------|
| `/nova Comprar leite` | Cria tarefa "Comprar leite" |
| `/concluir 1` | Marca tarefa #1 como concluída |
| `/andamento 1` | Marca tarefa #1 como em andamento |
| `/urgente 1` | Move tarefa #1 para quadrante "Fazer" |
| `/delegar 1` | Delega tarefa #1 |
| `/listar` | Lista tarefas pendentes |
| `/ajuda` | Mostra comandos disponíveis |

## Relatório WhatsApp

Formatado com emojis e markdown do WhatsApp:

```text
📊 *Relatório Diário - 13/03*

✅ *Concluídas:* 5 tarefas
🔄 *Em andamento:* 3 tarefas
⏳ *Pendentes:* 8 tarefas

🔥 *Próximos prazos:*
• Entregar relatório - amanhã
• Reunião cliente - em 2 dias

🍅 *Pomodoros:* 6 completados
🏆 *Nível:* 12 (2.450 XP)
```

## Arquivos Frontend

| Arquivo | Mudança |
|---------|---------|
| `src/pages/SettingsPage.tsx` | Nova seção "WhatsApp" com QR code, toggle de lembretes/relatórios |
| `src/hooks/useWhatsApp.ts` | Hook para gerenciar conexão, status, configurações |
| `src/components/WhatsAppQRCode.tsx` | Componente do QR code com polling de status |

## Segurança

- Cada instância Evolution é nomeada com o `user_id` → isolamento multi-tenant
- Webhook valida origem via secret compartilhado
- RLS garante que cada usuário só vê sua própria conexão
- Secrets (EVOLUTION_API_URL, EVOLUTION_API_KEY) são configurados uma vez no projeto

## Ordem de implementação

1. Configurar secrets (Evolution API URL + Key)
2. Migration da tabela `whatsapp_connections`
3. Edge functions: `whatsapp-connect`, `whatsapp-disconnect`, `whatsapp-send`
4. UI: seção WhatsApp em Settings com QR code
5. Edge function: `whatsapp-webhook` + processamento de comandos
6. Edge function: `whatsapp-report` + cron diário
7. Integrar lembretes existentes com envio WhatsApp

