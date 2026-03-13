

## Problema Identificado

Analisando os network requests, o campo `qr_code` salvo no banco já contém o prefixo `data:image/png;base64,` completo. Porém, o componente `WhatsAppQRCode.tsx` adiciona esse prefixo novamente na linha 59:

```
src={`data:image/png;base64,${connection.qr_code}`}
```

Resultando em: `data:image/png;base64,data:image/png;base64,iVBOR...` — uma URL inválida que não renderiza a imagem.

## Correções

### 1. Corrigir o `src` da imagem no `WhatsAppQRCode.tsx`
Detectar se o `qr_code` já tem o prefixo data URI e usá-lo diretamente, sem duplicar:

```tsx
src={connection.qr_code.startsWith('data:') ? connection.qr_code : `data:image/png;base64,${connection.qr_code}`}
```

### 2. Normalizar no `whatsapp-connect` edge function
Ao salvar o `qr_code` no banco, remover o prefixo `data:image/png;base64,` se presente, para manter consistência (armazenar apenas o base64 puro). Isso evita problemas futuros.

Ambas as correções são simples e isoladas — uma linha no componente, uma normalização no edge function.

