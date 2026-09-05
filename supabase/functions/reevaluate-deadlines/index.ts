/**
 * reevaluate-deadlines
 * ──────────────────────────────────────────────────────────────────────
 * Reavalia prazos: sobe a urgência pela regra de tempo até o vencimento e usa
 * IA para sugerir nova importância, criando sugestões de reclassificação.
 *
 * Chamada ........... pg_cron 06:00 (x-internal-secret ou service role) → todos
 *                     os usuários; OU front (JWT, AISuggestionsSheet.tsx) → só
 *                     as tarefas do usuário logado
 * Entrada ........... {} | { user_id?, limit?, dry_run? } (user_id só em chamada interna)
 * Saída ............. { processed, urgencyApplied, suggestionsCreated, errors, truncated }
 * Lê ................ tasks, projects, subtasks, task_attachments
 * Escreve ........... tasks, task_reclassification_suggestions, notifications
 * Env ............... AI_API_KEY (+ AI_MODEL_JULGAR), INTERNAL_FUNCTION_SECRET,
 *                     REEVAL_MAX_TAREFAS, REEVAL_ORCAMENTO_MS (opcionais)
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  - Lovable AI Gateway -> finalidade 'julgar' (roda no cron, ninguém esperando:
 *    qualidade acima de latência).
 *  - Sem JWT e sem segredo interno a chamada era aceita e varria TODOS os
 *    usuários. Agora: cron autenticado varre tudo; usuário só o que é dele.
 *  - O histórico de tags era relido a CADA tarefa (até 200 linhas por tarefa).
 *    Agora é lido uma vez por usuário e reaproveitado no lote inteiro.
 *  - ORÇAMENTO DE TEMPO: cada tarefa custa uma chamada de IA. O lote é limitado
 *    e a varredura para quando o tempo fica curto, devolvendo truncated:true. A
 *    próxima execução pega o resto — a seleção é sempre por due_date.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chat, type Tool } from '../_shared/ai.ts';
import { admin, getUser, isInternalCall } from '../_shared/supabase.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const HORIZONTE_DIAS = 7;
const MAX_TAREFAS = Number(Deno.env.get('REEVAL_MAX_TAREFAS')) || 150;
// O edge-runtime self-hosted tem wall-clock limitado por função (padrão ~150s
// no supabase/edge-runtime; configurável em supabase/functions/main). Sobra folga.
const ORCAMENTO_MS = Number(Deno.env.get('REEVAL_ORCAMENTO_MS')) || 100_000;
const HISTORICO_LIMITE = 200;

/** Urgência derivada do tempo até o vencimento. null = fora da janela de interesse. */
function urgenciaPeloPrazo(dueIso: string | null): number | null {
  if (!dueIso) return null;
  const horas = (new Date(dueIso).getTime() - Date.now()) / 36e5;
  if (horas <= 24) return 5;
  if (horas <= 72) return 4;
  if (horas <= 24 * 7) return 3;
  return null;
}

/** Corte em 3 — DIFERENTE do corte de classify-task (>=4). Mantido como no original. */
function quadrantePara(urgency: number, importance: number): string {
  const u = urgency >= 3;
  const i = importance >= 3;
  if (u && i) return 'do';
  if (!u && i) return 'schedule';
  if (u && !i) return 'delegate';
  return 'eliminate';
}

const TOOL: Tool = {
  type: 'function',
  function: {
    name: 'rate_importance',
    description: 'Rate task importance 1-5 with reasoning',
    parameters: {
      type: 'object',
      properties: {
        importance: { type: 'number', minimum: 1, maximum: 5 },
        reason: { type: 'string' },
      },
      required: ['importance', 'reason'],
      additionalProperties: false,
    },
  },
};

async function importanciaPelaIA(dossie: Row): Promise<{ importance: number; reason: string } | null> {
  const prompt = `You evaluate task IMPORTANCE (1-5) on the Eisenhower Matrix.
Importance reflects long-term value, alignment with goals/projects, and consequences of NOT doing it.
Use the dossier (content + user history signals). Return importance 1-5 and a short reason (max 140 chars, in Brazilian Portuguese).

Dossier:
${JSON.stringify(dossie, null, 2)}`;

  const r = await chat({
    proposito: 'julgar',
    temperature: 0,
    tools: [TOOL],
    toolChoice: 'rate_importance',
    messages: [{ role: 'user', content: prompt }],
  });

  const call = r.toolCalls.find((c) => c.name === 'rate_importance');
  if (!call) return null;
  const importance = Math.round(Number(call.arguments.importance));
  if (!Number.isFinite(importance)) return null;
  return {
    importance: Math.min(5, Math.max(1, importance)),
    reason: String(call.arguments.reason || '').slice(0, 200),
  };
}

async function contar(tabela: string, taskId: string): Promise<number> {
  const { count } = await admin().from(tabela).select('id', { count: 'exact', head: true }).eq('task_id', taskId);
  return count ?? 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  const inicio = Date.now();

  try {
    const corpo = await lerCorpo(req);
    const interno = isInternalCall(req);
    let alvo: string | null = null;

    if (interno) {
      alvo = corpo.user_id || null; // cron: todos; chamada manual pode restringir
    } else {
      const user = await getUser(req);
      if (!user) throw erro('Não autenticado', 401);
      alvo = user.id; // usuário comum: só as próprias tarefas, sempre
    }

    const dryRun = !!corpo.dry_run;
    const teto = Math.min(Number(corpo.limit) || MAX_TAREFAS, MAX_TAREFAS);
    const horizonte = new Date(Date.now() + HORIZONTE_DIAS * 24 * 36e5).toISOString();
    const db = admin();

    let q = db
      .from('tasks')
      .select('id, title, description, tags, urgency, importance, quadrant, due_date, created_by, project_id, projects(name, team_id, tenant_id)')
      .in('status', ['pending', 'in_progress'])
      .not('due_date', 'is', null)
      .lte('due_date', horizonte)
      // O vencimento mais próximo primeiro: se o lote truncar, trunca no que menos importa.
      .order('due_date', { ascending: true })
      .limit(teto);
    if (alvo) q = q.eq('created_by', alvo);

    const { data: tasks, error } = await q;
    if (error) throw error;

    // Cache por usuário: o histórico de tags é o mesmo para todas as tarefas dele.
    const historicoPorUsuario = new Map<string, Row[]>();
    const stats = { processed: 0, urgencyApplied: 0, suggestionsCreated: 0, errors: 0, truncated: false };

    for (const t of (tasks ?? []) as Row[]) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        stats.truncated = true;
        console.log(`reevaluate-deadlines: orçamento de tempo esgotado em ${stats.processed}/${tasks?.length} tarefas`);
        break;
      }
      stats.processed++;

      try {
        const novaUrg = urgenciaPeloPrazo(t.due_date);
        if (novaUrg === null) continue;

        // 1) Regra determinística de urgência — só sobe, nunca desce.
        const urgAplicada = Math.max(novaUrg, t.urgency ?? 3);
        if (urgAplicada !== t.urgency) {
          if (!dryRun) {
            await db.from('tasks')
              .update({ urgency: urgAplicada, quadrant: quadrantePara(urgAplicada, t.importance ?? 3) })
              .eq('id', t.id);
          }
          stats.urgencyApplied++;
        }

        // 2) Dossiê para a IA.
        if (!historicoPorUsuario.has(t.created_by)) {
          const { data: hist } = await db.from('tasks').select('status, importance, tags').eq('created_by', t.created_by).limit(HISTORICO_LIMITE);
          historicoPorUsuario.set(t.created_by, hist ?? []);
        }
        const historico = historicoPorUsuario.get(t.created_by) ?? [];

        const [subCount, attCount] = await Promise.all([contar('subtasks', t.id), contar('task_attachments', t.id)]);

        const tags: string[] = t.tags || [];
        const tagStats: Record<string, { done: number; elim: number; total: number }> = {};
        for (const h of historico) {
          for (const tag of h.tags || []) {
            if (!tags.includes(tag)) continue;
            tagStats[tag] ||= { done: 0, elim: 0, total: 0 };
            tagStats[tag].total++;
            if (h.status === 'completed') tagStats[tag].done++;
            if (h.status === 'eliminated') tagStats[tag].elim++;
          }
        }

        const proj = t.projects;
        const dossie = {
          title: t.title,
          description: t.description,
          tags,
          project: proj?.name,
          shared: !!(proj?.team_id || proj?.tenant_id),
          subtask_count: subCount,
          attachment_count: attCount,
          current_importance: t.importance,
          tag_history: tagStats,
        };

        const ia = await importanciaPelaIA(dossie);
        if (!ia) continue;

        // 3) Sugestão só quando a IA discorda em pelo menos 1 ponto.
        if (Math.abs(ia.importance - (t.importance ?? 3)) < 1) continue;
        if (dryRun) { stats.suggestionsCreated++; continue; }

        // Dedupe: expira as pendentes desta tarefa antes de criar a nova.
        await db.from('task_reclassification_suggestions')
          .update({ status: 'expired', resolved_at: new Date().toISOString() })
          .eq('task_id', t.id).eq('status', 'pending');

        const { error: insErr } = await db.from('task_reclassification_suggestions').insert({
          task_id: t.id,
          user_id: t.created_by,
          current_quadrant: t.quadrant || 'do',
          suggested_quadrant: quadrantePara(urgAplicada, ia.importance),
          current_importance: t.importance ?? 3,
          suggested_importance: ia.importance,
          current_urgency: t.urgency ?? 3,
          applied_urgency: urgAplicada,
          reason: ia.reason,
          signals: dossie,
        });
        if (insErr) throw insErr;
        stats.suggestionsCreated++;

        // Notificação é best-effort: falhar aqui não invalida a sugestão já gravada.
        const { error: notErr } = await db.from('notifications').insert({
          user_id: t.created_by,
          type: 'ai_reclassification',
          title: 'Sugestão de reclassificação',
          body: `${t.title}: a IA sugere mudar a importância`,
          metadata: { task_id: t.id },
        });
        if (notErr) console.error(`reevaluate-deadlines: notificação falhou para ${t.id}: ${notErr.message}`);
      } catch (e) {
        console.error(`reevaluate-deadlines: tarefa ${t.id}: ${(e as Error).message}`);
        stats.errors++;
      }
    }

    console.log(
      `reevaluate-deadlines: ${stats.processed} processadas, ${stats.urgencyApplied} urgências, ` +
      `${stats.suggestionsCreated} sugestões, ${stats.errors} erros em ${Math.round((Date.now() - inicio) / 1000)}s`,
    );
    return json(stats);
  } catch (e) {
    console.error('reevaluate-deadlines:', e);
    return respostaErro(e);
  }
});
