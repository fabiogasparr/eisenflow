

# Otimização Mobile do EisenFlow

## Problemas Identificados

1. **`App.css` com estilos conflitantes**: `#root` tem `max-width: 1280px`, `padding: 2rem` e `text-align: center` — resquícios do template Vite que limitam o layout e adicionam padding desnecessário no mobile
2. **Sem meta tags PWA**: Falta `theme-color`, `apple-mobile-web-app-capable`, e `apple-mobile-web-app-status-bar-style` no `index.html`
3. **Sem safe areas**: O layout não respeita `env(safe-area-inset-*)` para iPhones com notch
4. **Bottom nav corta conteúdo**: O `pb-14` no `<main>` é fixo, mas o bottom nav pode ficar sob a safe area em iPhones
5. **Header apertado no mobile**: Muitos elementos (tenant selector, focus mode, create, notification, theme, language) competem por espaço em 375px
6. **Quadrantes empilhados sem accordion**: Os 4 quadrantes em coluna única ocupam muito scroll; não há forma rápida de colapsar
7. **Fontes externas sem preconnect**: Google Fonts carregado sem `preconnect`, adicionando latência

## Solução

### 1. Limpar `App.css`
Remover os estilos do template Vite (`#root`, `.logo`, `.card`, `.read-the-docs`) que conflitam com o layout.

### 2. Meta tags mobile no `index.html`
Adicionar `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, e `preconnect` para Google Fonts.

### 3. Safe areas no CSS e Bottom Nav
- Adicionar `viewport-fit=cover` na meta viewport
- Usar `env(safe-area-inset-bottom)` no bottom nav e no padding do `<main>`
- Ajustar o `pb` do main para considerar safe area

### 4. Header mobile compacto
- Esconder o tenant selector label no mobile (mostrar só o ícone)
- Agrupar theme + language num único dropdown "⋮" no mobile
- Manter apenas os botões essenciais visíveis (criar tarefa, focus mode)

### 5. Quadrantes colapsáveis no mobile
No mobile (< 640px), cada quadrante pode ser colapsado/expandido com um toque no header. Por padrão, "Fazer Agora" vem expandido e os outros colapsados. Isso reduz drasticamente o scroll.

### 6. Touch feedback melhorado
- Adicionar `active:scale-[0.98]` nos cards de tarefa para feedback tátil
- Garantir que o grip handle esteja sempre visível no touch

## Arquivos modificados

| Arquivo | Ação |
|---------|------|
| `src/App.css` | Limpar estilos do template Vite |
| `index.html` | Meta tags mobile + preconnect |
| `src/index.css` | Safe area utilities |
| `src/components/BottomNav.tsx` | Safe area bottom padding |
| `src/components/AppLayout.tsx` | Ajustar padding do main com safe area |
| `src/components/AppHeader.tsx` | Header compacto no mobile |
| `src/components/QuadrantDropZone.tsx` | Colapsável no mobile |
| `src/pages/Index.tsx` | Estado de collapse dos quadrantes |
| `src/components/TaskCard.tsx` | Touch feedback visual |

