

# Melhorias no Google Calendar: Tela de Callback + Import Automático

## Problemas

1. **Tela de callback feia**: Após autorizar o Google, o popup mostra HTML cru com script visível (screenshot do usuário)
2. **Botão "Importar do Calendar" desnecessário**: O usuário quer que os eventos sejam importados automaticamente quando sincronizar, sem ação manual separada

## Mudanças

### 1. Melhorar tela de callback (`supabase/functions/google-calendar-auth/index.ts`)

Substituir o HTML simples da resposta de sucesso (linha 155-163) por uma página estilizada com:
- Background branco, fonte sans-serif, ícone de check verde (SVG inline)
- Mensagem "Google Calendar conectado com sucesso!"
- Texto secundário "Esta janela será fechada automaticamente..."
- O script de `postMessage` + `window.close()` continua funcionando igual, mas fica oculto no HTML bem formatado
- Fazer o mesmo para a página de erro (linha 112-114 e 148-151)

### 2. Remover botão "Importar do Calendar" (`src/pages/SettingsPage.tsx`)

- Remover o botão de importação separado (linhas 250-258)
- O "Sincronizar agora" já faz export + import bidirecionalmente (lógica atual do `syncAllTasks`)

### 3. Import automático ao carregar tarefas (`src/hooks/useGoogleCalendar.ts`)

- Adicionar um `useEffect` que, quando `isConnected && sync_enabled`, dispara automaticamente o `import-events` uma vez por sessão (usando flag em `sessionStorage` para evitar repetição)
- Isso garante que ao abrir o app, eventos do Google são importados sem precisar clicar nada

### 4. Remover `importEvents` do hook público

- Manter apenas internamente; remover do retorno do hook e da Settings

### Arquivos modificados
- `supabase/functions/google-calendar-auth/index.ts` — HTML bonito no callback
- `src/pages/SettingsPage.tsx` — remover botão importar
- `src/hooks/useGoogleCalendar.ts` — auto-import ao carregar

