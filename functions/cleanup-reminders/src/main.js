/**
 * cleanup-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Apaga lembretes já finalizados (sent, failed, cancelled, skipped) com mais
 * de N dias, para a fila não crescer indefinidamente.
 *
 * Origem: supabase/functions/cleanup-reminders/index.ts
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .... cron  0 3 * * *
 * Entrada .... nenhuma (ou { days } numa chamada manual)
 * Saída ...... { ok:true, deleted, scanned }
 *
 * DIFERENÇA DO POSTGRES: não existe DELETE em lote por filtro no Appwrite.
 * A varredura é paginada por cursor e apaga documento a documento, em lotes
 * pequenos para não estourar o rate limit do servidor.
 */
import { db, Query } from '../_shared/appwrite.js';
import { body, err, isScheduled } from '../_shared/http.js';

const TERMINAL = ['sent', 'failed', 'cancelled', 'skipped'];
const DEFAULT_DAYS = 7;
const PAGE = 100;
const MAX_PER_RUN = 5000;

export default async ({ req, res, log, error }) => {
  try {
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    const days = Number(body(req).days) > 0 ? Number(body(req).days) : DEFAULT_DAYS;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    let deleted = 0;
    let scanned = 0;
    let cursor = null;

    while (deleted < MAX_PER_RUN) {
      const queries = [
        Query.equal('status', TERMINAL),
        Query.lessThan('scheduled_at', cutoff),
        Query.orderAsc('scheduled_at'),
        Query.limit(PAGE),
      ];
      if (cursor) queries.push(Query.cursorAfter(cursor));

      const page = await db.list('scheduled_reminders', queries);
      const docs = page.documents || [];
      if (docs.length === 0) break;
      scanned += docs.length;

      for (const doc of docs) {
        try {
          await db.delete('scheduled_reminders', doc.$id);
          deleted++;
        } catch (e) {
          error(`cleanup-reminders: falha ao apagar ${doc.$id}: ${e.message}`);
        }
      }

      // Ao apagar da própria página, o cursor deixa de existir — recomeça do topo.
      cursor = null;
      if (docs.length < PAGE) break;
    }

    log(`cleanup-reminders: ${deleted} apagados de ${scanned} varridos (corte ${cutoff})`);
    return res.json({ ok: true, deleted, scanned, cutoff });
  } catch (e) {
    error(`cleanup-reminders: ${e.message}`);
    return err(res, e);
  }
};
