

# Mover botões Modo Foco e Nova Tarefa para o Header

## O que muda

Os botões "Modo Foco" e "Nova Tarefa" saem do conteúdo da página Index e vão para o `AppHeader`, posicionados à esquerda do ícone de notificações.

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/components/AppHeader.tsx` | Receber callbacks `onFocusMode` e `onCreateTask` via props; renderizar os 2 botões antes do `NotificationCenter` |
| `src/components/AppLayout.tsx` | Passar as novas props do AppHeader |
| `src/pages/Index.tsx` | Remover os botões do bloco "Header row"; passar `onFocusMode` e `onCreateTask` para o AppLayout |

## Detalhes

- `AppHeader` ganha props opcionais `onFocusMode?: () => void` e `onCreateTask?: () => void`
- Quando presentes, renderiza os botões (com ícones Target e Plus) à esquerda do `NotificationCenter`
- `AppLayout` repassa essas props
- Em `Index.tsx`, o bloco header com `justify-between` e o `<div />` vazio é removido

