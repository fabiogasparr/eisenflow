/**
 * cleanup-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Apaga lembretes já finalizados (sent, failed, cancelled, skipped) com mais
 * de N dias, para a fila não crescer indefinidamente.
 *
 * Chamada ........... pg_cron 03:00 (x-internal-secret ou service role)
 * Entrada ........... nenhuma (ou { days } numa chamada manual)
 * Saída ............. { ok, deleted }
 * Escreve ........... scheduled_reminders
 * Env ............... INTERNAL_FUNCTION_SECRET
 *
 * MUDANÇA: passou a exigir chamada interna (era aberta).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

const TERMINAL = ['sent', 'failed', 'cancelled', 'skipped'];
const DEFAULT_DAYS = 7;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    requireInternal(req);
    const corpo = await lerCorpo(req);
    const days = Number(corpo.days) > 0 ? Number(corpo.days) : DEFAULT_DAYS;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    const { count, error } = await admin()
      .from('scheduled_reminders')
      .delete({ count: 'exact' })
      .in('status', TERMINAL)
      .lt('updated_at', cutoff);
    if (error) throw error;

    console.log(`cleanup-reminders: ${count ?? 0} lembretes apagados (> ${days} dias)`);
    return json({ ok: true, deleted: count ?? 0 });
  } catch (e) {
    console.error('cleanup-reminders:', e);
    return respostaErro(e);
  }
});
