
Objetivo: corrigir o layout do Chat IA no celular para que o campo de digitação fique sempre visível, remover a rolagem “sobrando” da página e manter o estado vazio centralizado.

1) Ajustar o container principal para evitar dupla rolagem (página + chat)
- Arquivo: `src/components/AppLayout.tsx`
- Adicionar um prop opcional `mainClassName` no `AppLayout`.
- Mesclar esse prop na `<main>` (com `cn`) para permitir override por página.
- No chat, usar esse override para deixar a `main` com `overflow-hidden` e sem `pb-14`, evitando o “scroll fantasma” global.

2) Tornar o Chat IA um layout de altura fechada no mobile
- Arquivo: `src/pages/AIChatPage.tsx`
- Passar `mainClassName="overflow-hidden pb-0 md:pb-0"` no `AppLayout`.
- Manter estrutura em 3 blocos fixos: header do chat / área de mensagens / input.
- Garantir `min-h-0` e `flex-1` corretos para que só a área de mensagens role.
- No input, usar padding inferior apenas necessário para barra inferior + safe area:
  `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-3`.

3) Centralizar estado vazio e esconder barra visual de rolagem no chat
- Arquivo: `src/pages/AIChatPage.tsx`
- Transformar conteúdo da `ScrollArea` para preencher toda altura disponível (`h-full flex flex-col`).
- Quando não houver mensagens, usar bloco `flex-1 items-center justify-center` para deixar o conteúdo exatamente no meio.
- Esconder apenas a barra visual do Radix nessa tela (sem desativar scroll por toque), para cumprir “sem barra de rolagem” mantendo usabilidade quando houver muitas mensagens.

Detalhes técnicos
- Causa raiz: combinação de padding inferior global da `main` + padding extra no input do chat + containers com overflow concorrente.
- Estratégia: uma única área rolável (mensagens), input sempre ancorado no rodapé útil da tela, e compensação correta da navegação inferior no mobile.
- Não haverá mudança de backend; somente ajustes de layout/CSS e composição de containers React.

Critérios de aceite
- Em mobile (375px de largura), o campo “Descreva uma tarefa...” fica sempre visível acima da bottom nav.
- A página não apresenta rolagem extra quando o chat está vazio.
- O conteúdo inicial (“Como posso ajudar?”) aparece centralizado verticalmente.
- Com histórico grande, apenas a área de mensagens rola (sem quebrar o input fixo).
