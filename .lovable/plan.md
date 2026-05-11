# Validação e mensagens de erro robustas para anexos no Chat de IA

Hoje `addImages` em `src/pages/AIChatPage.tsx` faz validação básica, mas:
- Trunca silenciosamente quando o usuário tenta anexar mais que `MAX_IMAGES_PER_MSG` (4).
- Mostra um toast genérico por arquivo, sem nome do arquivo nem motivo detalhado.
- Não checa extensão quando `file.type` vem vazio (acontece com HEIC em alguns browsers).
- Não dá feedback visível das regras (limites/formatos) antes do usuário tentar.

## Escopo (somente frontend)

Mudanças apenas em **`src/pages/AIChatPage.tsx`**. Sem migrations, sem edge functions.

## Comportamento

1. **Validação por arquivo, com motivo específico**
   - Para cada arquivo, classificar em uma destas razões e coletar:
     - `invalid_type`: MIME fora de `ALLOWED` **e** extensão fora de `['png','jpg','jpeg','webp','heic']`.
     - `too_large`: `file.size > MAX_BYTES` (10 MB).
     - `empty`: `file.size === 0` (arquivo corrompido/vazio).
     - `over_count`: passou do limite `MAX_IMAGES_PER_MSG` considerando o que já está em `pending`.
   - Aceitos: vão para `accepted[]`.

2. **Toast agregado (1 por categoria)**
   - Em vez de 1 toast por arquivo (spam), 1 toast por motivo, listando os nomes dos arquivos rejeitados.
   - Exemplos PT/EN:
     - `Formato não suportado` — descrição: `"foto.gif, doc.pdf — use PNG, JPG, WEBP ou HEIC"`.
     - `Arquivo muito grande` — descrição: `"video.png (12 MB) — máx. 10 MB"`.
     - `Limite de anexos atingido` — descrição: `"3 imagem(ns) ignorada(s). Máx. 4 por mensagem."`.
     - `Arquivo vazio` — descrição: `"img.png está vazio"`.
   - Toast de sucesso opcional só quando há mistura (alguns aceitos + alguns rejeitados): `"2 imagem(ns) anexada(s), 1 ignorada(s)"`.

3. **Feedback positivo não-bloqueante**
   - Se todos passarem, sem toast (já há thumbnail visual).
   - Se nenhum passar, toast destrutivo único explicando.

4. **Helper visível na UI**
   - Pequeno texto abaixo da barra de input (ou tooltip no botão `Paperclip`):
     - PT: `Máx. 4 imagens · 10 MB cada · PNG, JPG, WEBP, HEIC`
     - EN: `Max 4 images · 10 MB each · PNG, JPG, WEBP, HEIC`
   - Aparece só quando `pending.length === 0` para não poluir.
   - Atributo `title` no botão `Paperclip` espelha a mesma info.

5. **Botão `Paperclip` desabilitado com motivo**
   - Já desabilita quando atinge o limite. Adicionar `title` dinâmico:
     - Quando cheio: `"Limite de 4 imagens atingido"`.

6. **Atualizar `accept` do `<input type="file">`**
   - Acrescentar `image/jpg` (já em `ALLOWED`) e manter os demais. Sem alteração funcional, só consistência.

7. **Cobrir os 3 caminhos de entrada**
   - `addImages` é chamado por: input file picker, paste (`handlePaste`) e drop (`handleDrop`). A nova validação fica centralizada em `addImages`, então todos cobrem.
   - Para `paste`/`drop`: se algum item descartado por não ser imagem (ex: arrastou um PDF), a categorização `invalid_type` cuida disso.

## Detalhes técnicos

```ts
type RejectReason = 'invalid_type' | 'too_large' | 'empty' | 'over_count';

const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic']);
const isImageFile = (f: File) => {
  if (ALLOWED.includes(f.type)) return true;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_OK.has(ext);
};

const fmtMB = (n: number) => (n / (1024 * 1024)).toFixed(1) + ' MB';

const addImages = (files: File[]) => {
  const rejects: Record<RejectReason, string[]> = {
    invalid_type: [], too_large: [], empty: [], over_count: [],
  };
  const accepted: PendingImage[] = [];
  let slotsLeft = MAX_IMAGES_PER_MSG - pending.length;

  for (const file of files) {
    if (!isImageFile(file))      { rejects.invalid_type.push(file.name); continue; }
    if (file.size === 0)         { rejects.empty.push(file.name); continue; }
    if (file.size > MAX_BYTES)   { rejects.too_large.push(`${file.name} (${fmtMB(file.size)})`); continue; }
    if (slotsLeft <= 0)          { rejects.over_count.push(file.name); continue; }
    slotsLeft--;
    accepted.push({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }

  if (accepted.length) setPending((prev) => [...prev, ...accepted]);

  const showToast = (title: string, list: string[]) => {
    if (!list.length) return;
    toast({
      title,
      description: list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : ''),
      variant: 'destructive',
    });
  };

  showToast(pt ? 'Formato não suportado — use PNG, JPG, WEBP ou HEIC'
              : 'Unsupported format — use PNG, JPG, WEBP or HEIC', rejects.invalid_type);
  showToast(pt ? `Arquivo muito grande — máx. 10 MB` : `File too large — max 10 MB`, rejects.too_large);
  showToast(pt ? 'Arquivo vazio' : 'Empty file', rejects.empty);
  if (rejects.over_count.length) {
    toast({
      title: pt ? 'Limite de anexos atingido' : 'Attachment limit reached',
      description: pt
        ? `${rejects.over_count.length} imagem(ns) ignorada(s). Máx. ${MAX_IMAGES_PER_MSG} por mensagem.`
        : `${rejects.over_count.length} image(s) skipped. Max ${MAX_IMAGES_PER_MSG} per message.`,
      variant: 'destructive',
    });
  }
};
```

**Helper UI** — adicionar abaixo do `<div className="flex gap-2 items-end">` (ou como `<p>` antes), condicionado a `pending.length === 0`:
```tsx
{pending.length === 0 && (
  <p className="text-[10px] text-muted-foreground px-1">
    {pt
      ? `Máx. ${MAX_IMAGES_PER_MSG} imagens · 10 MB cada · PNG, JPG, WEBP, HEIC`
      : `Max ${MAX_IMAGES_PER_MSG} images · 10 MB each · PNG, JPG, WEBP, HEIC`}
  </p>
)}
```

## Fora do escopo
- Não alterar `MAX_BYTES`, `MAX_IMAGES_PER_MSG` ou lista de formatos.
- Não tocar em `TaskAttachments` (validação já existe lá com seu próprio fluxo).
- Não alterar `chat-attachments` storage policies.
- Não adicionar zod (overkill para validação de File).
