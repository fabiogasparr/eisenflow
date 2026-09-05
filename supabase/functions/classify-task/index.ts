/**
 * classify-task
 * ──────────────────────────────────────────────────────────────────────
 * Classifica uma tarefa na Matriz de Eisenhower: quadrante, urgência (1-5)
 * e importância (1-5).
 *
 * Chamada ........... front (JWT), `invoke('classify-task', { title, description })`
 * Saída ............. { quadrant, urgency, importance }
 * Env ............... AI_API_KEY (+ AI_BASE_URL, AI_MODEL_CLASSIFICAR opcionais)
 *
 * MUDANÇAS: o original era público (verify_jwt=false) e usava o Lovable AI
 * Gateway. Aqui exige sessão do usuário e chama o OmniRoute por _shared/ai.ts,
 * com o modelo de finalidade 'classificar' (rápido, com tool calling).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chat, type Tool } from '../_shared/ai.ts';
import { requireUser } from '../_shared/supabase.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

const SYSTEM = `Você classifica tarefas na Matriz de Eisenhower.
Responda SEMPRE chamando a função classify_task, nunca em texto livre.

urgency (1-5): o quanto exige ação imediata — prazo curto, bloqueio de terceiros, consequência iminente.
importance (1-5): o quanto impacta objetivos de médio e longo prazo.

quadrant deriva dos dois eixos (corte em 3):
  urgency>=4 e importance>=4 -> "do"          (fazer agora)
  urgency<=3 e importance>=4 -> "schedule"    (agendar)
  urgency>=4 e importance<=3 -> "delegate"    (delegar)
  urgency<=3 e importance<=3 -> "eliminate"   (eliminar)`;

const TOOL: Tool = {
  type: 'function',
  function: {
    name: 'classify_task',
    description: 'Devolve a classificação da tarefa na Matriz de Eisenhower',
    parameters: {
      type: 'object',
      properties: {
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        urgency: { type: 'integer', minimum: 1, maximum: 5 },
        importance: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['quadrant', 'urgency', 'importance'],
    },
  },
};

const clamp = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 3)));

/** Rede de segurança: se a IA devolver quadrante inválido, deriva dos eixos. */
function quadrantFrom(urgency: number, importance: number): string {
  if (importance >= 4) return urgency >= 4 ? 'do' : 'schedule';
  return urgency >= 4 ? 'delegate' : 'eliminate';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    await requireUser(req);
    const { title, description } = await lerCorpo(req);
    if (!title || typeof title !== 'string') throw erro('title é obrigatório', 400);

    const result = await chat({
      proposito: 'classificar',
      temperature: 0,
      tools: [TOOL],
      toolChoice: 'classify_task',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Título: ${title}\nDescrição: ${description || '(sem descrição)'}` },
      ],
    });

    const call = result.toolCalls.find((c) => c.name === 'classify_task');
    if (!call) {
      console.log('classify-task: modelo não chamou a tool, aplicando fallback neutro');
      return json({ quadrant: 'schedule', urgency: 3, importance: 3, fallback: true });
    }

    const urgency = clamp(call.arguments.urgency, 1, 5);
    const importance = clamp(call.arguments.importance, 1, 5);
    const valid = ['do', 'schedule', 'delegate', 'eliminate'];
    const quadrant = valid.includes(call.arguments.quadrant) ? call.arguments.quadrant : quadrantFrom(urgency, importance);

    return json({ quadrant, urgency, importance });
  } catch (e) {
    console.error('classify-task:', e);
    return respostaErro(e);
  }
});
