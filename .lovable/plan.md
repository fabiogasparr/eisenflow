# Reaproveitar imagens da última mensagem como rascunho

Permitir, no `AIChatPage`, anexar com 1 clique as imagens enviadas na última mensagem do usuário, sem precisar re-selecionar arquivos do dispositivo.

## Escopo (somente frontend)

Mudanças apenas em **`src/pages/AIChatPage.tsx`**. Nenhuma migration, edge function ou alteração de schema.

## Comportamento

1. **Detectar última mensagem com imagens**
   - Procurar a última `ChatMessage` com `role === 'user'` e `imageUrls?.length > 0`.
   - Se existir e o `pending` tiver espaço (`< MAX_IMAGES_PER_MSG`), exibir um botão secundário ao lado do botão "Anexar":
     - PT: `Reusar últimas (N)` / EN: `Reuse last (N)`
     - Ícone: `History` ou `RotateCcw`
   - Botão fica oculto se não houver imagens anteriores.

2. **Adicionar como rascunho reutilizado**
   - Ao clicar, criar entradas `PendingImage` para cada URL — **sem `File`**, marcadas como `reused: true` com `reusedPath: string` e `previewUrl` apontando para a signed URL existente.
   - Respeitar `MAX_IMAGES_PER_MSG` e o espaço restante (`remaining = MAX - pending.length`); se exceder, anexar só o que cabe e mostrar toast informativo.
   - Permitir reordenar/remover normalmente (drag-and-drop já existente funciona porque usa `id`).
   - Preview no diálogo continua funcionando (usa `previewUrl`).

3. **Envio sem reupload**
   - Em `uploadPendingImages`, para itens com `reused === true`:
     - Pular upload no Storage.
     - **Re-assinar** a URL via `supabase.storage.from('chat-attachments').createSignedUrl(reusedPath, 3600)` para garantir validade (signed URLs expiram em 1h).
   - Para itens novos (com `File`), comportamento atual: upload + signed URL.
   - Resultado final é um array de URLs misto, na ordem que o usuário deixou.

4. **Persistência do path para reuso futuro**
   - Hoje `ChatMessage` guarda só `imageUrls` (signed URLs). Adicionar `imagePaths?: string[]` armazenando o storage path retornado pelo upload (`${user.id}/${uuid}.${ext}`).
   - Quando o usuário clica "Reusar", iteramos `lastMsg.imagePaths` para criar os `PendingImage` reusados.
   - Se a mensagem foi reusada (paths já vieram de mensagens anteriores), os mesmos paths são copiados para a nova mensagem — habilitando reuso em cadeia.

5. **Limpeza de URLs**
   - Hoje `removePendingById` chama `URL.revokeObjectURL(found.previewUrl)`. Para itens reusados a previewUrl é uma signed URL HTTP (não blob), então só revogar quando o item tem `file` (blob URL). Mesmo cuidado em `setPending([])` após enviar e no botão "Limpar tudo".

## Detalhes técnicos

**Tipos**
```ts
interface PendingImage {
  id: string;
  file?: File;            // ausente quando reusado
  previewUrl: string;     // blob: URL ou signed URL
  reused?: boolean;
  reusedPath?: string;    // storage path para re-assinar
}

interface ChatMessage {
  // ... existentes
  imageUrls?: string[];
  imagePaths?: string[];  // novo: paths para reuso
}
```

**Helpers**
```ts
const revokeIfBlob = (url: string) => {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
};

const lastUserImages = useMemo(() => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && m.imagePaths?.length) {
      return { paths: m.imagePaths, urls: m.imageUrls ?? [] };
    }
  }
  return null;
}, [messages]);

const reuseLastImages = async () => {
  if (!lastUserImages) return;
  const remaining = MAX_IMAGES_PER_MSG - pending.length;
  if (remaining <= 0) {
    toast({ title: pt ? 'Limite de anexos atingido' : 'Attachment limit reached' });
    return;
  }
  const slice = lastUserImages.paths.slice(0, remaining);
  // re-assinar para garantir URL válida no preview
  const items: PendingImage[] = [];
  for (let i = 0; i < slice.length; i++) {
    const path = slice[i];
    const { data } = await supabase.storage
      .from('chat-attachments').createSignedUrl(path, 3600);
    items.push({
      id: crypto.randomUUID(),
      previewUrl: data?.signedUrl ?? lastUserImages.urls[i] ?? '',
      reused: true,
      reusedPath: path,
    });
  }
  setPending((prev) => [...prev, ...items]);
  if (slice.length < lastUserImages.paths.length) {
    toast({ title: pt
      ? `Adicionadas ${slice.length} de ${lastUserImages.paths.length}`
      : `Added ${slice.length} of ${lastUserImages.paths.length}` });
  }
};
```

**`uploadPendingImages` atualizado**
```ts
const result: { url: string; path: string }[] = [];
for (const p of pending) {
  if (p.reused && p.reusedPath) {
    const { data } = await supabase.storage
      .from('chat-attachments').createSignedUrl(p.reusedPath, 3600);
    if (data?.signedUrl) result.push({ url: data.signedUrl, path: p.reusedPath });
    continue;
  }
  // ... upload existente, retorna { url: signed.signedUrl, path }
}
return result; // chamadora separa em imageUrls/imagePaths
```

**`sendMessage`** — usar resultado para preencher `imageUrls` e `imagePaths` da nova mensagem.

**UI** — adicionar botão na barra de ações (perto do `fileInputRef` trigger):
```tsx
{lastUserImages && pending.length < MAX_IMAGES_PER_MSG && (
  <Button size="sm" variant="ghost" onClick={reuseLastImages} type="button">
    <History className="h-4 w-4 mr-1" />
    {pt ? `Reusar últimas (${lastUserImages.paths.length})`
        : `Reuse last (${lastUserImages.paths.length})`}
  </Button>
)}
```

**Indicador visual no thumbnail** — para itens `reused`, badge pequeno no canto:
```tsx
{item.reused && (
  <span className="absolute top-1 right-1 text-[9px] bg-secondary text-secondary-foreground px-1 rounded">
    ↻
  </span>
)}
```

## Fora do escopo
- Não persistir histórico de chat no banco (segue só em memória/sessão).
- Não criar uma "galeria" de imagens já usadas — o reuso é apenas da última mensagem.
- Não alterar `chat-attachments` storage policies.
- Não tocar em `TaskAttachments` (fluxo separado).
