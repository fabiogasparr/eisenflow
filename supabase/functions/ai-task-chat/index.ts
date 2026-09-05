/**
 * ai-task-chat
 * ──────────────────────────────────────────────────────────────────────
 * Chat de IA que cria tarefas estruturadas ou responde em linguagem natural,
 * com texto e imagens.
 *
 * Chamada ........... front (JWT), AIChatPage.tsx
 * Entrada ........... { messages[], context?: {teamMembers[], projects[]}, images?: string[] }
 * Saída ............. { type:'tasks', tasks[], summary } | { type:'chat', message }
 * Env ............... AI_API_KEY (+ AI_BASE_URL, AI_MODEL_CONVERSAR/VISAO opcionais)
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  - Era pública (qualquer um queimava crédito de IA). Agora exige sessão.
 *  - Lovable AI Gateway -> chat() de _shared/ai.ts. Nada de nome de modelo fixo:
 *    'visao' quando há imagem, 'conversar' quando é só texto.
 *  - Os IDs devolvidos pela IA passam a ser VALIDADOS contra as listas do
 *    contexto. O prompt original só pedia "não invente IDs" — e modelo inventa.
 *    Aqui, ID que não está na lista é descartado em vez de virar referência
 *    quebrada no banco.
 *  - Quem grava as tarefas continua sendo o front (contrato preservado).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chat, imagePart, type Tool } from '../_shared/ai.ts';
import { requireUser } from '../_shared/supabase.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

const SYSTEM_PROMPT = `Você é um assistente de produtividade inteligente do EisenFlow, especializado na Matriz de Eisenhower.

Quando o usuário descrever uma tarefa ou projeto, você deve:
1. Analisar a descrição e criar tarefas estruturadas
2. Classificar cada tarefa no quadrante correto da Matriz de Eisenhower
3. Para projetos complexos, quebrar em subtarefas menores e acionáveis
4. Se houver membros de time disponíveis, sugerir atribuições inteligentes

QUANDO O USUÁRIO ENVIAR IMAGENS (prints, fotos, recibos, post-its, agendas, e-mails, atas, fluxogramas):
- Faça OCR cuidadoso e extraia TODO o texto visível
- Descreva o conteúdo visual quando relevante (gráficos, diagramas, layouts)
- Identifique itens acionáveis (listas, tópicos, deadlines, decisões) e use a tool create_tasks
- Se a imagem for apenas informativa (sem ação), responda com chat_response resumindo o que viu
- Inclua na descrição da tarefa o trecho do texto extraído da imagem que originou a tarefa

Quadrantes da Matriz de Eisenhower:
- "do": Fazer Agora — Urgente E Importante (crises, deadlines imediatos)
- "schedule": Agendar — Importante mas NÃO Urgente (planejamento, crescimento)
- "delegate": Delegar — Urgente mas NÃO Importante (interrupções, reuniões rotineiras)
- "eliminate": Eliminar — NÃO Urgente e NÃO Importante (distrações, tarefas desnecessárias)

Urgência e Importância são valores de 1 a 5.

Sempre use a tool create_tasks quando o usuário descrever (em texto ou imagem) tarefas ou projetos.
Use chat_response para respostas conversacionais que não envolvam criação de tarefas.

IMPORTANTE: Os campos project_id e assigned_to_id DEVEM ser UUIDs válidos copiados exatamente das listas de "Projetos disponíveis" e "Membros do time" do contexto. NUNCA invente IDs, nunca use nomes, categorias ou caminhos como "Pessoal/Networking". Se não houver correspondência exata na lista, OMITA o campo.

Responda sempre no idioma que o usuário usar.`;

const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'create_tasks',
      description: "Create one or more tasks from the user's description or images. Use this whenever the user describes (or shows in an image) work to be done.",
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Task title, concise and actionable' },
                description: { type: 'string', description: 'Detailed description; include relevant text extracted from images' },
                quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
                urgency: { type: 'number', minimum: 1, maximum: 5 },
                importance: { type: 'number', minimum: 1, maximum: 5 },
                estimated_time: { type: 'number', description: 'Estimated time in minutes' },
                assigned_to_id: { type: 'string' },
                assigned_to_name: { type: 'string' },
                project_id: { type: 'string' },
              },
              required: ['title', 'quadrant', 'urgency', 'importance'],
              additionalProperties: false,
            },
          },
          summary: { type: 'string', description: 'Brief summary of what was created and why; mention image content when applicable' },
        },
        required: ['tasks', 'summary'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat_response',
      description: "Send a conversational response when no task creation is needed. Use this to summarize/describe an image when it isn't actionable.",
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
    },
  },
];

const QUADRANTES = ['do', 'schedule', 'delegate', 'eliminate'];
const clamp = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 3)));

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    await requireUser(req);
    const { messages, context, images } = await lerCorpo(req);
    if (!Array.isArray(messages) || messages.length === 0) throw erro('messages é obrigatório', 400);

    // Listas do contexto: servem ao prompt E à validação dos IDs devolvidos.
    const membros: Json[] = Array.isArray(context?.teamMembers) ? context.teamMembers : [];
    const projetos: Json[] = Array.isArray(context?.projects) ? context.projects : [];
    const idsMembros = new Set(membros.map((m) => m.id));
    const idsProjetos = new Set(projetos.map((p) => p.id));

    let contexto = '';
    if (membros.length) {
      contexto += `\n\nMembros do time disponíveis para atribuição:\n${membros.map((m) => `- ${m.name} (ID: ${m.id})`).join('\n')}`;
    }
    if (projetos.length) {
      contexto += `\n\nProjetos disponíveis:\n${projetos.map((p) => `- ${p.name} (ID: ${p.id})`).join('\n')}`;
    }

    // Imagens entram como conteúdo multimodal da ÚLTIMA mensagem do usuário.
    const temImagens = Array.isArray(images) && images.length > 0;
    const apiMessages: Json[] = messages.map((m: Json) => ({ role: m.role, content: m.content }));
    const ultima = apiMessages[apiMessages.length - 1];
    if (temImagens && ultima?.role === 'user') {
      const texto = typeof ultima.content === 'string' ? ultima.content : '';
      apiMessages[apiMessages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: texto || 'Analise a(s) imagem(ns) anexada(s).' },
          ...images.map((url: string) => imagePart(url)),
        ],
      };
    }

    const result = await chat({
      // Com imagem a leitura é o gargalo -> modelo de visão. Sem imagem, o que
      // importa é a qualidade da conversa.
      proposito: temImagens ? 'visao' : 'conversar',
      temperature: 0.3,
      tools: TOOLS,
      messages: [{ role: 'system', content: SYSTEM_PROMPT + contexto }, ...apiMessages],
    });

    const call = result.toolCalls?.[0];

    if (call?.name === 'chat_response') {
      return json({ type: 'chat', message: call.arguments.message || '' });
    }

    if (call?.name === 'create_tasks') {
      const brutas: Json[] = Array.isArray(call.arguments.tasks) ? call.arguments.tasks : [];
      const tasks = brutas
        .filter((t) => typeof t?.title === 'string' && t.title.trim())
        .map((t) => ({
          title: String(t.title).slice(0, 500),
          description: t.description ? String(t.description).slice(0, 20000) : null,
          quadrant: QUADRANTES.includes(t.quadrant) ? t.quadrant : 'schedule',
          urgency: clamp(t.urgency, 1, 5),
          importance: clamp(t.importance, 1, 5),
          estimated_time: Number.isFinite(Number(t.estimated_time)) ? Math.max(0, Math.round(Number(t.estimated_time))) : null,
          // ID que não veio da lista do contexto é alucinação: descarta.
          assigned_to_id: idsMembros.has(t.assigned_to_id) ? t.assigned_to_id : null,
          assigned_to_name: idsMembros.has(t.assigned_to_id) ? t.assigned_to_name || null : null,
          project_id: idsProjetos.has(t.project_id) ? t.project_id : null,
        }));

      if (!tasks.length) {
        return json({ type: 'chat', message: call.arguments.summary || 'Não identifiquei tarefas acionáveis.' });
      }
      return json({ type: 'tasks', tasks, summary: call.arguments.summary || '' });
    }

    return json({ type: 'chat', message: result.content || 'Não entendi. Pode reformular?' });
  } catch (e) {
    console.error('ai-task-chat:', e);
    return respostaErro(e);
  }
});
