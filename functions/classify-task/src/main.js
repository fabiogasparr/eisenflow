/**
 * classify-task
 * ──────────────────────────────────────────────────────────────────────
 * Classifica uma tarefa na Matriz de Eisenhower: quadrante, urgência (1-5)
 * e importância (1-5).
 *
 * Origem: supabase/functions/classify-task/index.ts
 * Status: PORTADA (lógica completa)
 *
 * Entrada .... { title, description? }
 * Saída ...... { quadrant, urgency, importance }
 * Variáveis .. AI_API_KEY (+ AI_PROVIDER, AI_MODEL opcionais)
 *
 * MUDANÇA: o original era público e usava o Lovable AI Gateway. Aqui exige
 * sessão do usuário e chama o provider configurado em _shared/ai.js.
 */
import { chat } from '../_shared/ai.js';
import { requireUser } from '../_shared/auth.js';
import { body, err } from '../_shared/http.js';

const SYSTEM = `Você classifica tarefas na Matriz de Eisenhower.
Responda SEMPRE chamando a função classify_task, nunca em texto livre.

urgency (1-5): o quanto exige ação imediata — prazo curto, bloqueio de terceiros, consequência iminente.
importance (1-5): o quanto impacta objetivos de médio e longo prazo.

quadrant deriva dos dois eixos (corte em 3):
  urgency>=4 e importance>=4 -> "do"          (fazer agora)
  urgency<=3 e importance>=4 -> "schedule"    (agendar)
  urgency>=4 e importance<=3 -> "delegate"    (delegar)
  urgency<=3 e importance<=3 -> "eliminate"   (eliminar)`;

const TOOL = {
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

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 3)));

/** Rede de segurança: se a IA falhar, deriva o quadrante dos eixos. */
function quadrantFrom(urgency, importance) {
  if (importance >= 4) return urgency >= 4 ? 'do' : 'schedule';
  return urgency >= 4 ? 'delegate' : 'eliminate';
}

export default async ({ req, res, log, error }) => {
  try {
    await requireUser(req);

    const { title, description } = body(req);
    if (!title || typeof title !== 'string') {
      return res.json({ ok: false, error: 'title é obrigatório' }, 400);
    }

    const result = await chat({
      temperature: 0,
      tools: [TOOL],
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Título: ${title}\nDescrição: ${description || '(sem descrição)'}` },
      ],
    });

    const call = result.toolCalls.find((c) => c.name === 'classify_task');
    if (!call) {
      log('classify-task: modelo não chamou a tool, aplicando fallback neutro');
      return res.json({ quadrant: 'schedule', urgency: 3, importance: 3, fallback: true });
    }

    const urgency = clamp(call.arguments.urgency, 1, 5);
    const importance = clamp(call.arguments.importance, 1, 5);
    const valid = ['do', 'schedule', 'delegate', 'eliminate'];
    const quadrant = valid.includes(call.arguments.quadrant)
      ? call.arguments.quadrant
      : quadrantFrom(urgency, importance);

    return res.json({ quadrant, urgency, importance });
  } catch (e) {
    error(`classify-task: ${e.message}`);
    return err(res, e);
  }
};
