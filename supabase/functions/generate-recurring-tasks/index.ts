/**
 * generate-recurring-tasks
 * ──────────────────────────────────────────────────────────────────────
 * Cria a próxima ocorrência das tarefas recorrentes já concluídas ou eliminadas.
 *
 * Chamada ........... pg_cron 04:00 (x-internal-secret ou service role)
 * Entrada ........... nenhuma
 * Saída ............. { ok, created, skipped, examined }
 * Lê/Escreve ........ tasks
 * Env ............... INTERNAL_FUNCTION_SECRET
 *
 * CORREÇÕES EM RELAÇÃO À VERSÃO LOVABLE:
 *  1. IDEMPOTÊNCIA. O original só pulava quando já existia um filho PENDENTE.
 *     Assim que esse filho era concluído, o pai (que continua completed, com
 *     recurrence_rule) gerava OUTRO filho na noite seguinte — e o filho, que
 *     também é recorrente, gerava o dele: duas ocorrências por período, para
 *     sempre. Aqui a checagem é por QUALQUER filho, em qualquer status: cada
 *     ocorrência gera no máximo uma sucessora, e a cadeia anda sozinha.
 *  2. tenant_id. O insert original esquecia o tenant_id, e a ocorrência nova
 *     saía órfã do tenant (invisível para o time). Copiado aqui.
 *  3. REGRA DESCONHECIDA. Numa regra fora de daily/weekly/monthly o original
 *     criava a ocorrência com o MESMO due_date do pai — uma tarefa nascida
 *     vencida. Aqui a tarefa é pulada e a regra é logada.
 *  4. Passou a exigir chamada interna (era aberta).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { json, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const ORCAMENTO_MS = 100_000;
const STATUS_ORIGEM = ['completed', 'eliminated'];

/** Avança o prazo em um período. null = sem prazo; undefined = regra desconhecida. */
function proximoPrazo(due: string | null, regra: string): string | null | undefined {
  if (!due) return null;
  const base = new Date(due);
  switch (regra) {
    case 'daily': base.setDate(base.getDate() + 1); break;
    case 'weekly': base.setDate(base.getDate() + 7); break;
    case 'monthly': base.setMonth(base.getMonth() + 1); break;
    default: return undefined;
  }
  return base.toISOString();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  const inicio = Date.now();

  try {
    requireInternal(req);
    const db = admin();

    const { data: candidatas, error } = await db
      .from('tasks')
      .select('*')
      .not('recurrence_rule', 'is', null)
      .in('status', STATUS_ORIGEM);
    if (error) throw error;
    const lista: Row[] = candidatas ?? [];

    // Filhos já existentes, em lote — evita uma query por tarefa (correção 1).
    const filhos = new Set<string>();
    const ids = lista.map((t) => t.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('tasks').select('recurrence_parent_id').in('recurrence_parent_id', ids.slice(i, i + 200));
      (data ?? []).forEach((d: Row) => filhos.add(d.recurrence_parent_id));
    }

    let criadas = 0, puladas = 0, examinadas = 0;

    for (const t of lista) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        console.log(`generate-recurring-tasks: orçamento esgotado após ${examinadas} tarefas; o resto sai amanhã`);
        break;
      }
      examinadas++;

      if (filhos.has(t.id)) { puladas++; continue; }

      const prazo = proximoPrazo(t.due_date, t.recurrence_rule);
      if (prazo === undefined) {
        console.log(`generate-recurring-tasks: regra desconhecida "${t.recurrence_rule}" na tarefa ${t.id} — pulada`);
        puladas++;
        continue;
      }

      const { error: insErr } = await db.from('tasks').insert({
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
        recurrence_parent_id: t.id,
        due_date: prazo,
        status: 'pending',
        position: 0,
      });
      if (insErr) {
        console.error(`generate-recurring-tasks: falha ao gerar a partir de ${t.id}: ${insErr.message}`);
        continue;
      }
      filhos.add(t.id);
      criadas++;
    }

    console.log(`generate-recurring-tasks: ${criadas} criadas, ${puladas} puladas, ${examinadas}/${lista.length} examinadas`);
    return json({ ok: true, created: criadas, skipped: puladas, examined: examinadas });
  } catch (e) {
    console.error('generate-recurring-tasks:', e);
    return respostaErro(e);
  }
});
