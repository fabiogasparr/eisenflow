## Objetivo

Permitir que o EisenFlow receba **imagens** (prints, fotos, recibos, anotações, diagramas) em três pontos do app e use IA com visão para fazer **OCR**, **descrever conteúdo visual** e **estruturar tarefas** automaticamente. As imagens ficam salvas no app, vinculadas à conversa ou tarefa.

---

## 1. Infraestrutura de armazenamento

Nova migração criando dois buckets privados em Lovable Cloud Storage:

- `chat-attachments` — imagens enviadas no chat de IA (organizadas por `user_id/...`)
- `task-attachments` — imagens vinculadas a tarefas (organizadas por `tenant_id/task_id/...`)

Políticas RLS no `storage.objects`:
- Usuário só lê/escreve dentro da própria pasta (`auth.uid()::text = (storage.foldername(name))[1]`)
- Para `task-attachments`: leitura/escrita liberada para membros do tenant da tarefa

Nova tabela `task_attachments`:
- `task_id`, `uploaded_by`, `storage_path`, `mime_type`, `size_bytes`, `ocr_text` (texto extraído pela IA), `ai_description` (descrição visual), `created_at`
- RLS: visível para quem vê a tarefa; insert por quem pode editar a tarefa

Limites: máx 10 MB por imagem, formatos `image/png|jpeg|webp|heic`.

---

## 2. Chat de IA com imagem (`AIChatPage` + `ai-task-chat`)

**Frontend (`src/pages/AIChatPage.tsx`)**
- Botão de clipe ao lado do `Textarea` para anexar 1+ imagens (também aceita colar print do clipboard e drag-and-drop)
- Preview em miniatura antes de enviar
- Upload para `chat-attachments/{user_id}/{uuid}` → gera signed URL
- Envia para a edge function: `messages` + array `images: [{ url, name }]`

**Edge function (`supabase/functions/ai-task-chat/index.ts`)**
- Aceita `images` no payload
- Monta a mensagem do usuário no formato multimodal do Lovable AI Gateway:
  ```
  content: [{ type: "text", text }, { type: "image_url", image_url: { url } }]
  ```
- Modelo: `google/gemini-2.5-pro` quando houver imagem (melhor visão), senão mantém `google/gemini-3-flash-preview`
- Atualiza system prompt: instrui a fazer OCR, descrever, e usar a tool `create_tasks` quando a imagem contiver itens acionáveis (lista, post-it, agenda, e-mail, ata)

---

## 3. Anexos visuais em tarefas

**Frontend (`src/components/TaskDetailSheet.tsx` + novo `TaskAttachments.tsx`)**
- Seção "Anexos" no detalhe da tarefa: upload, grid de thumbnails, abrir em lightbox, deletar
- Botão "Analisar com IA" em cada anexo → chama edge function `analyze-task-image`
- Mostra `ocr_text` e `ai_description` retornados; opção "Adicionar à descrição da tarefa" e "Gerar subtarefas a partir desta imagem"

**Nova edge function `analyze-task-image`**
- Recebe `attachment_id`
- Busca arquivo no Storage (signed URL), chama Lovable AI Gateway (`google/gemini-2.5-pro`, modalidade visão)
- Persiste `ocr_text` + `ai_description` em `task_attachments`
- Retorna sugestões de subtarefas (tool calling estruturado)

`useSubtasks` é reutilizado para criar as subtarefas sugeridas.

---

## 4. WhatsApp com imagem

**`supabase/functions/whatsapp-webhook/index.ts`**
- Detectar `messageType === 'imageMessage'` no payload da Evolution API
- Baixar mídia via endpoint da Evolution (`/chat/getBase64FromMediaMessage`) usando `EVOLUTION_API_KEY`
- Subir no bucket `chat-attachments/{user_id}/whatsapp/{message_id}.jpg`
- Encaminhar para o mesmo pipeline de IA do chat (mensagem multimodal: caption do WhatsApp + imagem)
- Resposta de volta ao usuário pelo WhatsApp com resumo do que foi extraído e tarefas criadas
- Registrar a interação em `whatsapp_chat_history` (texto: "[imagem] " + caption + resumo da IA)

---

## 5. UX e i18n

- Novas chaves em `src/i18n/translations.ts` (PT-BR e EN): `attachImage`, `analyzingImage`, `ocrResult`, `imageDescription`, `addToDescription`, `generateSubtasks`, `attachmentsSection`, `dropImageHere`, `imageTooLarge`, etc.
- Toasts de erro para: arquivo grande demais, formato inválido, falha de upload, créditos esgotados (402), rate limit (429)
- Loading states (Skeleton) durante análise

---

## Detalhes técnicos

**Modelo de IA**: `google/gemini-2.5-pro` (multimodal, melhor para OCR e interpretação visual). Fallback para `google/gemini-3-flash-preview` quando só texto. Sem chave externa — usa `LOVABLE_API_KEY` já provisionada.

**Formato multimodal no Gateway** (compatível OpenAI):
```json
{
  "model": "google/gemini-2.5-pro",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "image_url", "image_url": { "url": "https://...signed" } }
    ]
  }]
}
```

**Segurança**:
- Buckets privados, signed URLs com expiração curta (1h) para passar à IA
- RLS por pasta de usuário e por membership de tenant
- Validação de mime type e tamanho no frontend e na edge function
- Edge functions validam JWT (`supabase.auth.getClaims`)

**Custo/limites**:
- Imagens consomem mais tokens; limitar a 4 imagens por mensagem
- Surface 402/429 do Gateway como toast

---

## Arquivos afetados

Criação:
- `supabase/migrations/<novo>.sql` (buckets, `task_attachments`, RLS)
- `supabase/functions/analyze-task-image/index.ts`
- `src/components/TaskAttachments.tsx`
- `src/components/ImageLightbox.tsx`
- `src/hooks/useTaskAttachments.ts`

Edição:
- `src/pages/AIChatPage.tsx` (anexar/colar/arrastar imagens, preview)
- `supabase/functions/ai-task-chat/index.ts` (suporte multimodal, troca de modelo)
- `supabase/functions/whatsapp-webhook/index.ts` (download de mídia, pipeline visual)
- `src/components/TaskDetailSheet.tsx` (seção de anexos)
- `src/i18n/translations.ts` (novas chaves PT/EN)
- `supabase/config.toml` (entrada para `analyze-task-image` se necessário)

---

## Fora de escopo

- Geração de imagens pela IA (só leitura/análise)
- Vídeo, áudio ou PDF (apenas imagens nesta fase — PDF/áudio podem ser próximo passo)
- Edição de imagens dentro do app
