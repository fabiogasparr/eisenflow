/**
 * dispatch-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Drena a fila de lembretes vencidos (`scheduled_reminders`) e entrega por
 * canal (in_app, browser, whatsapp pessoal/tenant, email).
 *
 * Chamada ........... pg_cron a cada 5 min (x-internal-secret ou service role)
 * Entrada ........... nenhuma (opcional: { limite })
 * Saída ............. { ok, processed, sent, failed, skipped, cancelled, restantes }
 * Lê ................ scheduled_reminders, tasks, whatsapp_connections,
 *                     tenant_whatsapp_connections, tenant_member_phones
 * Escreve ........... scheduled_reminders, notifications
 * APIs externas ..... Evolution GO
 * Env ............... EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET
 *
 * Quem PRODUZ a fila são os triggers do Postgres (trg_tasks_reminders_sync,
 * trg_task_reminders_expand) e `process-recurring-schedules`. Esta function é
 * só a consumidora.
 *
 * CORREÇÕES EM RELAÇÃO À VERSÃO LOVABLE:
 *  1. IDEMPOTÊNCIA (cron a cada 5 min não pode mandar duas vezes). O original
 *     entregava e SÓ DEPOIS marcava 'sent' — uma execução que travasse no meio,
 *     ou duas sobrepostas, reenviavam a mesma mensagem. Aqui o item é RESERVADO
 *     antes da entrega com um UPDATE condicional (`status='pending'` no WHERE):
 *     se outra execução já reservou, o update não afeta linha nenhuma e o item
 *     é pulado. Confirmada a entrega, grava-se sent_at; se falhar, volta para
 *     'pending' (ou 'failed' no 3º attempt). Efeito colateral aceito: uma queda
 *     no meio deixa o item 'sent' sem sent_at — erra para o lado de NÃO reenviar.
 *  2. Tarefa concluída/eliminada/apagada antes da entrega -> item 'cancelled'
 *     (o trigger já faz isso na maioria dos casos; aqui é a rede de segurança).
 *  3. WhatsApp pelo token da instância (Evolution GO), direto — a conexão já
 *     foi lida aqui, passar por whatsapp-send só custaria uma chamada a mais.
 *  4. Passou a exigir chamada interna (era aberta).
 *  5. Orçamento de tempo: o que não couber fica 'pending' para o próximo tique.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { evolution } from '../_shared/evolution.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const LOTE_MAX = 200;
const ORCAMENTO_MS = 100_000;
const MAX_ATTEMPTS = 3;
const STATUS_TERMINAL_TAREFA = ['completed', 'eliminated'];

/** Rótulo por tipo de lembrete — cópia do labelFor() do original. */
function rotuloDe(kind: string): string {
  switch (kind) {
    case 'due_d1': return '⏰ Prazo amanhã';
    case 'due_1h': return '⏰ Prazo em 1 hora';
    case 'due_now': return '🔴 Prazo agora';
    case 'start_now': return '▶️ Hora de iniciar';
    case 'start_5min': return '⏳ Inicia em 5 min';
    case 'custom': return '🔔 Lembrete';
    case 'daily_summary': return '🌅 Resumo do dia';
    case 'weekly_plan': return '📅 Plano da semana';
    default: return '🔔 Lembrete';
  }
}

/** Cache de leitura por execução: a mesma conexão serve vários lembretes. */
function memo<T>(carregar: (chave: string) => Promise<T>) {
  const cache = new Map<string, T>();
  return async (chave: string): Promise<T> => {
    if (!cache.has(chave)) cache.set(chave, await carregar(chave));
    return cache.get(chave) as T;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  const inicio = Date.now();

  try {
    requireInternal(req);
    const db = admin();

    const entrada = await lerCorpo(req);
    const limite = Math.min(Number(entrada.limite) > 0 ? Number(entrada.limite) : LOTE_MAX, LOTE_MAX);
    const agora = new Date().toISOString();

    const { data: lote, error } = await db
      .from('scheduled_reminders')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', agora)
      .order('scheduled_at', { ascending: true })
      .limit(limite);
    if (error) throw error;
    const itens: Row[] = lote ?? [];

    // Estado das tarefas em lote.
    const taskIds = [...new Set(itens.map((i) => i.task_id).filter(Boolean))];
    const tarefas = new Map<string, Row>();
    if (taskIds.length) {
      const { data } = await db.from('tasks').select('id, status').in('id', taskIds);
      (data ?? []).forEach((t: Row) => tarefas.set(t.id, t));
    }

    const conexaoPessoal = memo(async (userId) => {
      const { data } = await db.from('whatsapp_connections').select('*').eq('user_id', userId).maybeSingle();
      return data as Row | null;
    });
    const conexaoTenant = memo(async (tenantId) => {
      const { data } = await db.from('tenant_whatsapp_connections').select('*').eq('tenant_id', tenantId).maybeSingle();
      return data as Row | null;
    });
    const telefoneTenant = memo(async (chave) => {
      const [tenantId, userId] = chave.split('|');
      const { data } = await db.from('tenant_member_phones').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
      return data as Row | null;
    });

    let enviados = 0, falhos = 0, pulados = 0, cancelados = 0, processados = 0;

    for (const item of itens) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        console.log(`dispatch-reminders: orçamento de tempo esgotado; ${itens.length - processados} ficam para o próximo tique`);
        break;
      }
      processados++;

      // (2) tarefa concluída/eliminada/apagada -> não entrega nada.
      if (item.task_id) {
        const tarefa = tarefas.get(item.task_id);
        if (!tarefa || STATUS_TERMINAL_TAREFA.includes(tarefa.status)) {
          await db.from('scheduled_reminders').update({
            status: 'cancelled',
            last_error: tarefa ? `tarefa_${tarefa.status}` : 'tarefa_inexistente',
          }).eq('id', item.id);
          cancelados++;
          continue;
        }
      }

      const tentativas = (item.attempts ?? 0) + 1;

      // (1) reserva atômica: só quem ainda vê 'pending' leva o item.
      const { data: reservado, error: rErr } = await db
        .from('scheduled_reminders')
        .update({ status: 'sent', sent_at: null, attempts: tentativas })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');
      if (rErr || !reservado?.length) {
        if (rErr) console.error(`dispatch-reminders: não consegui reservar ${item.id}: ${rErr.message}`);
        continue;
      }

      const pular = async (motivo: string) => {
        await db.from('scheduled_reminders').update({ status: 'skipped', sent_at: null, last_error: motivo }).eq('id', item.id);
        pulados++;
      };

      try {
        const payload: Row = item.payload && typeof item.payload === 'object' ? item.payload : {};
        const titulo = rotuloDe(item.kind);
        const corpo = String(payload.task_title ?? payload.body ?? '');

        if (item.channel === 'in_app' || item.channel === 'browser') {
          // 'browser' continua sendo entregue como in_app: o cliente assina o
          // realtime de notifications e dispara a notificação do navegador.
          const { error: nErr } = await db.from('notifications').insert({
            user_id: item.user_id,
            type: `reminder_${item.kind}`,
            title: titulo,
            body: corpo,
            metadata: { task_id: item.task_id, scheduled_reminder_id: item.id, kind: item.kind },
          });
          if (nErr) throw nErr;

        } else if (item.channel === 'whatsapp_personal') {
          const conn = await conexaoPessoal(item.user_id);
          if (!conn || conn.status !== 'connected' || !conn.phone_number || !conn.reminders_enabled) {
            await pular('no_personal_whatsapp'); continue;
          }
          if (!conn.instance_token) { await pular('no_instance_token'); continue; }
          await evolution.sendText(conn.instance_token, String(conn.phone_number).replace(/\D/g, ''), `*${titulo}*\n${corpo}`);

        } else if (item.channel === 'whatsapp_tenant') {
          if (!item.tenant_id) { await pular('no_tenant'); continue; }

          const tconn = await conexaoTenant(item.tenant_id);
          if (!tconn || tconn.status !== 'connected' || !tconn.reminders_enabled) {
            await pular('tenant_wa_unavailable'); continue;
          }
          if (!tconn.instance_token) { await pular('no_instance_token'); continue; }
          const fone = await telefoneTenant(`${item.tenant_id}|${item.user_id}`);
          if (!fone || !fone.verified || !fone.receive_reminders) {
            await pular('phone_not_verified'); continue;
          }
          await evolution.sendText(tconn.instance_token, String(fone.phone_number).replace(/\D/g, ''), `*${titulo}*\n${corpo}`);

        } else if (item.channel === 'email') {
          // Sem infraestrutura de e-mail nas functions — igual ao original.
          await pular('email_not_configured'); continue;

        } else {
          await pular(`canal_desconhecido:${item.channel}`); continue;
        }

        // Confirma a reserva: sent_at é o que distingue entregue de reservado.
        await db.from('scheduled_reminders')
          .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
          .eq('id', item.id);
        enviados++;
      } catch (e) {
        // Desfaz a reserva: volta para a fila ou desiste no 3º attempt.
        const novoStatus = tentativas >= MAX_ATTEMPTS ? 'failed' : 'pending';
        const { error: e2 } = await db.from('scheduled_reminders').update({
          status: novoStatus,
          sent_at: null,
          last_error: String((e as Error)?.message ?? e).slice(0, 500),
        }).eq('id', item.id);
        if (e2) console.error(`dispatch-reminders: falha ao registrar erro de ${item.id}: ${e2.message}`);
        falhos++;
      }
    }

    console.log(`dispatch-reminders: ${processados}/${itens.length} processados — ${enviados} enviados, ${falhos} falhos, ${pulados} pulados, ${cancelados} cancelados`);
    return json({
      ok: true,
      processed: processados,
      sent: enviados,
      failed: falhos,
      skipped: pulados,
      cancelled: cancelados,
      restantes: Math.max(0, itens.length - processados),
    });
  } catch (e) {
    console.error('dispatch-reminders:', e);
    return respostaErro(e);
  }
});
