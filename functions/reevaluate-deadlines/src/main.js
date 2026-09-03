/**
 * reevaluate-deadlines
 * ──────────────────────────────────────────────────────────────────────
 * Reavalia prazos: sobe a urgência pela regra de tempo até o vencimento e usa
 * IA para sugerir nova importância, criando sugestões de reclassificação.
 *
 * Origem: supabase/functions/reevaluate-deadlines/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .......... cron  0 6 * * *  (timeout da function: 300s — ver appwrite.json)
 * Autenticação ..... servidor (agendamento ou x-internal-secret)
 * Entrada .......... vazio (cron) ou { user_id?, limit?, dry_run? }
 * Saída ............ { processed, urgencyApplied, suggestionsCreated, errors, truncated }
 * Lê ............... tasks, projects, subtasks, task_attachments, tenants
 * Escreve .......... tasks, task_reclassification_suggestions, notifications
 * APIs externas .... IA (_shared/ai.js -> OmniRoute)
 * Variáveis ........ AI_API_KEY, APPWRITE_API_KEY, INTERNAL_FUNCTION_SECRET
 *
 * MUDANÇAS EM RELAÇÃO AO ORIGINAL:
 *  - O join `projects(name, team_id, tenant_id)` do PostgREST virou uma única
 *    chamada db.loadRelated('projects', ids) e junção em memória.
 *  - `count: 'exact', head: true` não existe: o total vem do campo `total` de
 *    uma listagem com limit(1).
 *  - O histórico de tags era relido a CADA tarefa (até 200 docs por tarefa).
 *    Agora é lido uma vez por usuário e reaproveitado no lote inteiro — a mesma
 *    resposta com uma fração das requisições.
 *  - ORÇAMENTO DE TEMPO: a function tem 300s de timeout e cada tarefa custa uma
 *    chamada de IA. O lote é limitado (MAX_TAREFAS) e a varredura para quando o
 *    tempo restante fica curto, devolvendo truncated:true. A próxima execução
 *    pega o resto — nada se perde, porque a seleção é sempre por due_date.
 *  - Lovable AI Gateway -> proposito 'julgar' (roda no cron, ninguém esperando:
 *    qualidade acima de latência).
 */
import { db, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';
import { chat } from '../_shared/ai.js';
import { body, err, isScheduled } from '../_shared/http.js';

const HORIZONTE_DIAS = 7;
const MAX_TAREFAS = Number(process.env.REEVAL_MAX_TAREFAS) || 150;
const ORCAMENTO_MS = Number(process.env.REEVAL_ORCAMENTO_MS) || 240_000; // 300s de timeout, com folga
const HISTORICO_LIMITE = 200;

/** Urgência derivada do tempo até o vencimento. null = fora da janela de interesse. */
function urgenciaPeloPrazo(dueIso) {
  if (!dueIso) return null;
  const horas = (new Date(dueIso).getTime() - Date.now()) / 36e5;
  if (horas <= 24) return 5;
  if (horas <= 72) return 4;
  if (horas <= 24 * 7) return 3;
  return null;
}

/**
 * Corte em 3 — atenção: é DIFERENTE do corte de classify-task (que usa >=4).
 * Mantido como no original para não mudar o comportamento das sugestões.
 */
function quadrantePara(urgency, importance) {
  const u = urgency >= 3;
  const i = importance >= 3;
  if (u && i) return 'do';
  if (!u && i) return 'schedule';
  if (u && !i) return 'delegate';
  return 'eliminate';
}

const TOOL = {
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

async function importanciaPelaIA(dossie) {
  const prompt = `You evaluate task IMPORTANCE (1-5) on the Eisenhower Matrix.
Importance reflects long-term value, alignment with goals/projects, and consequences of NOT doing it.
Use the dossier (content + user history signals). Return importance 1-5 and a short reason (max 140 chars, in Brazilian Portuguese).

Dossier:
${JSON.stringify(dossie, null, 2)}`;

  const r = await chat({
    proposito: 'julgar',
    temperature: 0,
    tools: [TOOL],
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

/** Total de documentos que casam com a query, sem trazer os documentos. */
async function contar(collection, queries) {
  const r = await db.list(collection, [...queries, Query.limit(1)]);
  return r.total ?? 0;
}

/**
 * db.create()/db.update() carimbam updated_at, e nem
 * task_reclassification_suggestions nem notifications têm esse atributo —
 * o Appwrite recusaria a escrita. Estas duas escrevem direto.
 */
const criarSemUpdatedAt = (collection, data, permissions) =>
  rawCall('POST', `/databases/${DATABASE_ID}/collections/${collection}/documents`, {
    documentId: 'unique()',
    data: { created_at: new Date().toISOString(), ...data },
    ...(permissions ? { permissions } : {}),
  });

const patchSemUpdatedAt = (collection, id, data) =>
  rawCall('PATCH', `/databases/${DATABASE_ID}/collections/${collection}/documents/${id}`, { data });

export default async ({ req, res, log, error }) => {
  const inicio = Date.now();
  try {
    // Só agendamento ou chamada manual autenticada.
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    const { user_id: alvo, limit, dry_run: dryRun } = body(req);
    const teto = Math.min(Number(limit) || MAX_TAREFAS, MAX_TAREFAS);
    const horizonte = new Date(Date.now() + HORIZONTE_DIAS * 24 * 36e5).toISOString();

    const queries = [
      Query.equal('status', ['pending', 'in_progress']),
      Query.isNotNull('due_date'),
      Query.lessThanEqual('due_date', horizonte),
      // O vencimento mais próximo primeiro: se o lote truncar, trunca no que
      // menos importa.
      Query.orderAsc('due_date'),
    ];
    if (alvo) queries.push(Query.equal('created_by', alvo));

    const tasks = await db.listAll('tasks', queries, 100, teto);

    // Substitui o join tasks -> projects: uma query só, junção em memória.
    const projetos = await db.loadRelated('projects', tasks.map((t) => t.project_id));

    // Cache por usuário: o histórico de tags é o mesmo para todas as tarefas dele.
    const historicoPorUsuario = new Map();

    const stats = { processed: 0, urgencyApplied: 0, suggestionsCreated: 0, errors: 0, truncated: false };

    for (const t of tasks) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        stats.truncated = true;
        log(`reevaluate-deadlines: orçamento de tempo esgotado em ${stats.processed}/${tasks.length} tarefas`);
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
            // tasks tem updated_at: db.update carimba corretamente.
            // As permissões não mudam aqui (a titularidade é a mesma), então
            // não são reenviadas — reenviar apagaria os shares do documento.
            await db.update('tasks', t.$id, {
              urgency: urgAplicada,
              quadrant: quadrantePara(urgAplicada, t.importance ?? 3),
            });
          }
          stats.urgencyApplied++;
        }

        // 2) Dossiê para a IA.
        if (!historicoPorUsuario.has(t.created_by)) {
          historicoPorUsuario.set(
            t.created_by,
            await db.listAll('tasks', [Query.equal('created_by', t.created_by)], 100, HISTORICO_LIMITE),
          );
        }
        const historico = historicoPorUsuario.get(t.created_by);

        const [subCount, attCount] = await Promise.all([
          contar('subtasks', [Query.equal('task_id', t.$id)]),
          contar('task_attachments', [Query.equal('task_id', t.$id)]),
        ]);

        const tags = t.tags || [];
        const tagStats = {};
        for (const h of historico) {
          for (const tag of h.tags || []) {
            if (!tags.includes(tag)) continue;
            tagStats[tag] ||= { done: 0, elim: 0, total: 0 };
            tagStats[tag].total++;
            if (h.status === 'completed') tagStats[tag].done++;
            if (h.status === 'eliminated') tagStats[tag].elim++;
          }
        }

        const proj = t.project_id ? projetos.get(t.project_id) : null;
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
        const pendentes = await db.listAll('task_reclassification_suggestions', [
          Query.equal('task_id', t.$id),
          Query.equal('status', 'pending'),
        ]);
        const agora = new Date().toISOString();
        for (const p of pendentes) {
          await patchSemUpdatedAt('task_reclassification_suggestions', p.$id, {
            status: 'expired',
            resolved_at: agora,
          });
        }

        // Sem RLS: o dono da sugestão precisa poder lê-la e resolvê-la (aceitar/
        // rejeitar é um update).
        const donoLeEResolve = [
          `read("user:${t.created_by}")`,
          `update("user:${t.created_by}")`,
          `delete("user:${t.created_by}")`,
        ];

        await criarSemUpdatedAt(
          'task_reclassification_suggestions',
          {
            task_id: t.$id,
            user_id: t.created_by,
            current_quadrant: t.quadrant || 'do',
            suggested_quadrant: quadrantePara(urgAplicada, ia.importance),
            current_importance: t.importance ?? 3,
            suggested_importance: ia.importance,
            current_urgency: t.urgency ?? 3,
            applied_urgency: urgAplicada,
            reason: ia.reason.slice(0, 5000),
            signals: JSON.stringify(dossie).slice(0, 65535), // jsonb -> string(65535)
            status: 'pending',
          },
          donoLeEResolve,
        );
        stats.suggestionsCreated++;

        // Notificação é best-effort, como no original: falhar aqui não invalida
        // a sugestão já gravada. notifications é server-doc — o usuário só lê.
        try {
          await criarSemUpdatedAt(
            'notifications',
            {
              user_id: t.created_by,
              type: 'ai_reclassification',
              title: 'Sugestão de reclassificação',
              body: `${t.title}: a IA sugere mudar a importância`,
              metadata: JSON.stringify({ task_id: t.$id }),
              read: false,
            },
            [`read("user:${t.created_by}")`],
          );
        } catch (e) {
          error(`reevaluate-deadlines: notificação falhou para ${t.$id}: ${e.message}`);
        }
      } catch (e) {
        error(`reevaluate-deadlines: tarefa ${t.$id}: ${e.message}`);
        stats.errors++;
      }
    }

    log(
      `reevaluate-deadlines: ${stats.processed} processadas, ${stats.urgencyApplied} urgências, ` +
      `${stats.suggestionsCreated} sugestões, ${stats.errors} erros em ${Math.round((Date.now() - inicio) / 1000)}s`,
    );
    return res.json(stats);
  } catch (e) {
    error(`reevaluate-deadlines: ${e.message}`);
    return err(res, e);
  }
};
