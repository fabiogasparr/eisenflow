# Prévia editável de OCR ao anexar imagem

Hoje, ao anexar uma imagem em `TaskAttachments`, o usuário precisa clicar em "Analisar" para ver o texto extraído. A proposta é disparar o OCR automaticamente após o upload e exibir o texto em uma área editável, permitindo ajustes antes de adicionar à descrição ou gerar subtarefas.

## Escopo (somente frontend)

Mudanças em **`src/components/TaskAttachments.tsx`** e ajuste pequeno em **`src/hooks/useTaskAttachments.ts`** para suportar salvar OCR editado. Sem mudanças no edge function nem no schema (a tabela `task_attachments` já tem coluna `ocr_text` e policy de UPDATE para o dono).

## Comportamento

1. **Auto-análise no upload**
   - Após `upload.mutateAsync(file)` ter sucesso, disparar imediatamente `analyze.mutateAsync(att.id)` para o anexo recém-criado.
   - Abrir o painel de resultado já em estado "analisando..." (mesmo loader atual).
   - Para múltiplos arquivos, processa em série (a fila atual já é sequencial).
   - Anexos antigos sem `ai_analyzed_at` continuam podendo ser analisados manualmente pelo botão "Analisar".

2. **Prévia editável**
   - Substituir o `<pre>` somente leitura por um `<Textarea>` controlado (`editedOcr`), pré-preenchido com `analysis.ocr_text`.
   - Mostrar contador de caracteres e indicar visualmente quando há alterações não salvas (badge "Editado" + botão "Desfazer" que volta ao texto original).
   - Botão **"Salvar alterações"**: persiste o texto editado em `task_attachments.ocr_text` via novo mutation `updateOcr` no hook; em sucesso, atualiza `analysis.ocr_text` localmente e some o estado "Editado".
   - Botão **"Adicionar à descrição"** passa a usar `editedOcr` (não o original), exigindo confirmação se houver edits ainda não salvos (toast/AlertDialog leve, ou auto-save antes de adicionar — escolher auto-save para fluidez).

3. **Subtarefas sugeridas**
   - Continuam vindo da resposta inicial da IA (não recalcula ao editar OCR). Comportamento atual preservado.

4. **Estados de erro**
   - Se a auto-análise falhar (ex: imagem ilegível), exibir mensagem inline com botão "Tentar novamente" no painel, mantendo o anexo na lista.

## Detalhes técnicos

**`useTaskAttachments.ts`**
- Adicionar mutation:
  ```ts
  const updateOcr = useMutation({
    mutationFn: async ({ id, ocr_text }: { id: string; ocr_text: string }) => {
      const { error } = await supabase
        .from('task_attachments')
        .update({ ocr_text })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });
  ```
- Exportar `updateOcr` no retorno.

**`TaskAttachments.tsx`**
- Novo state: `editedOcr: string`, `originalOcr: string`.
- Em `handleFiles`, após cada `upload.mutateAsync`, chamar uma nova `autoAnalyze(att)` que faz set do `activeAtt` e dispara `analyze` (reaproveita `handleAnalyze`).
- No `useEffect` que reage a `analysis`, semear `editedOcr` e `originalOcr` com `analysis.ocr_text`.
- Trocar `<pre>` por `<Textarea rows={6}>` com `value={editedOcr}` e `onChange`.
- Adicionar botões: "Salvar alterações" (disabled quando `editedOcr === originalOcr`), "Desfazer" e badge "Editado" condicional.
- `handleAddToDescription` usa `editedOcr`; se diferente de `originalOcr`, faz `updateOcr` antes para manter persistência consistente.
- i18n PT/EN para todos os novos textos ("Salvar alterações"/"Save changes", "Desfazer"/"Reset", "Editado"/"Edited", "Tentar novamente"/"Retry", "Analisando automaticamente..."/"Auto-analyzing...").

## Fora do escopo
- Não mexer em `AIChatPage` (lá o OCR já roda no envio da mensagem, não no anexo).
- Sem novas migrations, edge functions, ou mudanças no schema.
- Sem alterar o prompt da IA ou a estrutura do retorno (`ocr_text`, `description`, `suggested_subtasks`).
