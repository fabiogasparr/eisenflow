

# Corrigir Layout do Chat IA

## Problema

O container do chat usa `h-[calc(100vh-2rem)]` mas não considera a altura do `AppHeader`. Isso faz o input ficar cortado/abaixo da viewport.

## Solução

Alterar `AIChatPage.tsx`:
- Mudar a altura do container de `h-[calc(100vh-2rem)]` para `h-full` e adicionar `overflow-hidden` ao wrapper
- Ajustar o `<main>` wrapper no `AppLayout` ou usar classes que façam o chat ocupar exatamente o espaço disponível entre header e bottom

Mudanças específicas:

| Arquivo | Mudança |
|---------|---------|
| `src/pages/AIChatPage.tsx` | Trocar `h-[calc(100vh-2rem)]` por `h-[calc(100vh-4rem)]` ou usar `h-full` com overflow correto |
| `src/components/AppLayout.tsx` | Garantir que `<main>` tenha `h-0` para flex shrink correto, permitindo que filhos usem `h-full` |

A abordagem: no `AppLayout`, adicionar `min-h-0` ao main para que o flex container funcione corretamente. No `AIChatPage`, usar `h-full` em vez do cálculo fixo de viewport, já que o parent (`main`) terá a altura correta.

