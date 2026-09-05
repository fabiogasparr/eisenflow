/**
 * process-recurring-schedules
 * ──────────────────────────────────────────────────────────────────────
 * Enfileira o resumo diário e o plano semanal (`recurring_schedules`) em
 * `scheduled_reminders` quando bate o horário LOCAL do usuário. Quem consome a
 * fila é `dispatch-reminders` (mesmo cron de 5 min).
 *
 * Chamada ........... pg_cron a cada 5 min (x-internal-secret ou service role)
 * Entrada ........... nenhuma
 * Saída ............. { ok, enqueued }
 * Lê ................ recurring_schedules, tasks
 * Escreve ........... scheduled_reminders, recurring_schedules (last_run_at)
 * Env ............... INTERNAL_FUNCTION_SECRET
 *
 * Os lembretes automáticos por tarefa (due_d1, due_1h, due_now, start_now)
 * continuam sendo produzidos pelos triggers do Postgres
 * (sync_task_auto_reminders / expand_task_reminder) — na versão anterior do backend isso tinha
 * sido absorvido aqui por falta de triggers; no Supabase volta para o banco.
 *
 * MUDANÇA: passou a exigir chamada interna (era aberta).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { json, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localTime(tz: string, quando = new Date()): { hour: number; minute: number; weekday: number; ymd: string } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
    });
  }
  const p = Object.fromEntries(fmt.formatToParts(quando).map((x) => [x.type, x.value]));
  return {
    hour: parseInt(p.hour || '0') % 24,
    minute: parseInt(p.minute || '0'),
    weekday: DIAS[p.weekday] ?? 0,
    ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

async function buildSummary(userId: string): Promise<string> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + 7);
  const { data } = await admin()
    .from('tasks')
    .select('title, due_date, status, quadrant')
    .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
    .in('status', ['pending', 'in_progress'])
    .gte('due_date', start.toISOString())
    .lte('due_date', end.toISOString())
    .order('due_date', { ascending: true })
    .limit(15);
  if (!data || data.length === 0) return 'Nenhuma tarefa pendente nos próximos dias. 🎉';
  return data.map((t: Row, i: number) => `${i + 1}. ${t.title}`).join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    requireInternal(req);
    const db = admin();

    const { data: schedules, error } = await db.from('recurring_schedules').select('*').eq('enabled', true);
    if (error) throw error;

    let enqueued = 0;
    for (const s of (schedules ?? []) as Row[]) {
      const tz = s.timezone || 'America/Sao_Paulo';
      const lt = localTime(tz);
      const [hh, mm] = String(s.cron_local).split(':').map(Number);
      const sched = hh * 60 + (mm || 0);
      const cur = lt.hour * 60 + lt.minute;
      // Janela de 5 min.
      if (Math.abs(cur - sched) > 4) continue;
      // Dia da semana para o plano semanal.
      if (s.kind === 'weekly_plan' && s.weekday !== null && s.weekday !== lt.weekday) continue;
      // Evita rodar duas vezes no mesmo dia local.
      if (s.last_run_at && localTime(tz, new Date(s.last_run_at)).ymd === lt.ymd) continue;

      const body = await buildSummary(s.user_id);
      const canais: string[] = Array.isArray(s.channels) && s.channels.length ? s.channels : ['in_app'];
      const linhas = canais.map((ch) => ({
        recurring_schedule_id: s.id,
        user_id: s.user_id,
        tenant_id: s.tenant_id,
        kind: s.kind,
        channel: ch,
        scheduled_at: new Date().toISOString(),
        status: 'pending',
        payload: { task_title: s.kind === 'weekly_plan' ? 'Plano da semana' : 'Resumo do dia', body },
      }));
      const { error: insErr } = await db.from('scheduled_reminders').insert(linhas);
      if (insErr) { console.error(`process-recurring-schedules: ${s.id}: ${insErr.message}`); continue; }
      enqueued += linhas.length;
      await db.from('recurring_schedules').update({ last_run_at: new Date().toISOString() }).eq('id', s.id);
    }

    console.log(`process-recurring-schedules: ${enqueued} lembretes enfileirados`);
    return json({ ok: true, enqueued });
  } catch (e) {
    console.error('process-recurring-schedules:', e);
    return respostaErro(e);
  }
});
