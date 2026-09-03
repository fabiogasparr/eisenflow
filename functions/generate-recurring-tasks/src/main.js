/**
 * generate-recurring-tasks
 * ──────────────────────────────────────────────────────────────────────
 * Cria a próxima ocorrência das tarefas recorrentes já concluídas ou eliminadas.
 *
 * Origem: supabase/functions/generate-recurring-tasks/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA
 *
 * Gatilho .......... cron  (0 4 * * *)
 * Autenticação ..... agendamento, ou x-internal-secret numa chamada manual
 * Entrada .......... nenhuma
 * Saída ............ { ok, created, examined, skipped }
 * Lê ............... tasks, tenants
 * Escreve .......... tasks
 * Variáveis ........ INTERNAL_FUNCTION_SECRET, APPWRITE_API_KEY
 *
 * ─── DECISÕES DO PORTE ────────────────────────────────────────────────
 *
 * 1. PERMISSÕES. No Postgres a RLS calculava o acesso a cada query; aqui a
 *    ocorrência nova precisa nascer com as permissões certas. Reproduz-se
 *    taskPermissions() de src/integrations/appwrite/permissions.ts: criador
 *    lê/edita/apaga, responsável lê/edita, e o Team do tenant lê. Não se copia
 *    o $permissions do pai porque ele pode carregar permissões de
 *    COMPARTILHAMENTO (task_shares), e o original não replicava os shares para
 *    a nova ocorrência — herdar as permissões daria acesso a quem não tem
 *    share na tarefa nova.
 *
 * 2. IDEMPOTÊNCIA. O original só pulava quando já existia um filho PENDENTE.
 *    Assim que esse filho era concluído, o pai (que continua completed, com
 *    recurrence_rule) gerava OUTRO filho na noite seguinte — e o filho, que
 *    também é recorrente, gerava o dele: duas ocorrências por período, para
 *    sempre. Aqui a checagem é por QUALQUER filho, em qualquer status: cada
 *    ocorrência gera no máximo uma sucessora, e a cadeia anda sozinha.
 *
 * 3. tenant_id. O insert original esquecia o tenant_id, e a ocorrência nova
 *    saía órfã do tenant (invisível para o time). Copiado aqui.
 *
 * 4. ARRAYS SEM DEFAULT. `tags` é atributo array e no Appwrite array não aceita
 *    default — aplica-se [] no código quando o pai não tem tags.
 *
 * 5. REGRA DESCONHECIDA. `recurrence_rule` é string(255); só daily/weekly/
 *    monthly são geradas pela UI. Numa regra desconhecida o original caía no
 *    default do switch e criava a ocorrência com o MESMO due_date do pai — uma
 *    tarefa nascida vencida. Aqui a tarefa é pulada e a regra é logada.
 */
import { db, Query } from '../_shared/appwrite.js';
import { body, err, isScheduled } from '../_shared/http.js';

const ORCAMENTO_MS = 45_000;   // timeout declarado é 60s
const STATUS_ORIGEM = ['completed', 'eliminated'];

/** Avança o prazo em um período. null = regra que não sabemos avançar. */
function proximoPrazo(due, regra) {
  if (!due) return null;
  const base = new Date(due);
  switch (regra) {
    case 'daily': base.setDate(base.getDate() + 1); break;
    case 'weekly': base.setDate(base.getDate() + 7); break;
    case 'monthly': base.setMonth(base.getMonth() + 1); break;
    default: return undefined; // undefined = regra desconhecida (ver decisão 5)
  }
  return base.toISOString();
}

/** Porte de taskPermissions() (src/integrations/appwrite/permissions.ts). */
function permissoesDaTarefa({ createdBy, assignedTo, tenantTeamId }) {
  const p = [
    `read("user:${createdBy}")`,
    `update("user:${createdBy}")`,
    `delete("user:${createdBy}")`,
  ];
  if (assignedTo && assignedTo !== createdBy) {
    p.push(`read("user:${assignedTo}")`, `update("user:${assignedTo}")`);
  }
  if (tenantTeamId) p.push(`read("team:${tenantTeamId}")`);
  return [...new Set(p)];
}

export default async ({ req, res, log, error }) => {
  const inicio = Date.now();
  try {
    if (!isScheduled(req)) {
      const segredo = process.env.INTERNAL_FUNCTION_SECRET;
      // Sem o segredo configurado, `undefined === undefined` liberaria geral.
      if (!segredo || req.headers['x-internal-secret'] !== segredo) {
        return res.json({ ok: false, error: 'somente execução agendada' }, 403);
      }
    }
    body(req); // corpo ignorado; aceito para não quebrar chamada manual

    // "not recurrence_rule is null" + "status in (completed, eliminated)"
    const candidatas = await db.listAll('tasks', [
      Query.isNotNull('recurrence_rule'),
      Query.equal('status', STATUS_ORIGEM),
    ]);

    // Filhos já existentes, em lote — evita uma query por tarefa (decisão 2).
    const filhos = new Set();
    const ids = candidatas.map((t) => t.$id);
    for (let i = 0; i < ids.length; i += 100) {
      const bloco = ids.slice(i, i + 100);
      const docs = await db.listAll('tasks', [Query.equal('recurrence_parent_id', bloco)]);
      docs.forEach((d) => filhos.add(d.recurrence_parent_id));
    }

    // tenant_id -> appwrite_team_id, para a permissão de leitura do time.
    const tenants = await db.loadRelated('tenants', candidatas.map((t) => t.tenant_id));

    let criadas = 0, puladas = 0, examinadas = 0;

    for (const t of candidatas) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        log(`generate-recurring-tasks: orçamento esgotado após ${examinadas} tarefas; o resto sai amanhã`);
        break;
      }
      examinadas++;

      if (filhos.has(t.$id)) { puladas++; continue; }

      const prazo = proximoPrazo(t.due_date, t.recurrence_rule);
      if (prazo === undefined) {
        log(`generate-recurring-tasks: regra desconhecida "${t.recurrence_rule}" na tarefa ${t.$id} — pulada`);
        puladas++;
        continue;
      }

      try {
        await db.create('tasks', {
          title: t.title,
          description: t.description ?? null,
          quadrant: t.quadrant,
          urgency: t.urgency,
          importance: t.importance,
          tags: Array.isArray(t.tags) ? t.tags : [],
          estimated_time: t.estimated_time ?? null,
          project_id: t.project_id ?? null,
          tenant_id: t.tenant_id ?? null,
          created_by: t.created_by,
          assigned_to: t.assigned_to ?? null,
          recurrence_rule: t.recurrence_rule,
          recurrence_parent_id: t.$id,
          due_date: prazo,
          status: 'pending',
          position: 0,
        }, permissoesDaTarefa({
          createdBy: t.created_by,
          assignedTo: t.assigned_to,
          tenantTeamId: tenants.get(t.tenant_id)?.appwrite_team_id ?? null,
        }));
        filhos.add(t.$id);
        criadas++;
      } catch (e) {
        error(`generate-recurring-tasks: falha ao gerar a partir de ${t.$id}: ${e.message}`);
      }
    }

    log(`generate-recurring-tasks: ${criadas} criadas, ${puladas} puladas, ${examinadas}/${candidatas.length} examinadas`);
    return res.json({ ok: true, created: criadas, skipped: puladas, examined: examinadas });
  } catch (e) {
    error(`generate-recurring-tasks: ${e.message}`);
    return err(res, e);
  }
};
