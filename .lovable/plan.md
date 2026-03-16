

## Problema

Na imagem do iPhone, o campo de digitação do chat não aparece -- fica escondido atrás da BottomNav (56px) + barra do Safari. O layout atual usa `h-full` no container do chat, mas o `<main>` pai tem `min-h-screen` no wrapper externo, o que faz o `h-full` não funcionar corretamente no mobile -- o container não respeita a altura real disponível, empurrando o input para fora da viewport.

## Causa raiz

O wrapper externo (`div.min-h-screen.flex.w-full`) define altura mínima da tela, mas `h-full` no filho do `<main>` não calcula corretamente a altura restante. O `overflow-hidden` no `<main>` esconde o input que fica abaixo da área visível. Além disso, o padding `pb-[calc(3.5rem+env(safe-area-inset-bottom))]` no input tenta compensar a BottomNav, mas como o container já excede a viewport, não ajuda.

## Solução

Usar `dvh` (dynamic viewport height) para garantir que o container do chat ocupe exatamente a altura visível da tela, independente da barra do Safari/Chrome no iPhone.

### Mudanças em `src/pages/AIChatPage.tsx`:

1. **Container principal**: trocar `h-full` por altura calculada com `dvh` que desconta header (56px) + BottomNav (56px):
   - `h-[calc(100dvh-7rem)] md:h-full` -- no mobile usa viewport dinâmica menos header+bottomnav; no desktop mantém `h-full`

2. **Input wrapper**: simplificar o padding inferior para apenas compensar a safe-area (a BottomNav já está fora do container):
   - `pb-[env(safe-area-inset-bottom,0.75rem)] md:pb-3` -- usa safe-area no mobile, padding normal no desktop

3. **Remover `!pb-0` do mainClassName** e usar `!pb-0` apenas no mobile, ou melhor, manter `overflow-hidden !pb-0` mas garantir que o container filho use altura absoluta via `dvh`.

### Arquivo: `src/pages/AIChatPage.tsx`

- Linha 174: `<div className="flex flex-col h-[calc(100dvh-7rem)] md:h-full min-h-0 max-w-3xl mx-auto">`
- Linha 280: `<div className="border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 shrink-0">`

Isso garante que todo o chat (header + mensagens + input) cabe exatamente na área visível do iPhone, sem scroll na página e com o input sempre visível acima da BottomNav.

