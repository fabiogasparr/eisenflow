/**
 * dispatch-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Drena a fila de lembretes vencidos e entrega por canal
 * (in_app, browser, whatsapp pessoal/tenant, email).
 *
 * Origem: supabase/functions/dispatch-reminders/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA
 *
 * Gatilho .......... cron  (*\/5 * * * *)
 * Autenticação ..... agendamento, ou x-internal-secret numa chamada manual
 * Entrada .......... nenhuma  (opcional: { limite })
 * Saída ............ { ok, processed, sent, failed, skipped, cancelled, restantes }
 * Lê ............... scheduled_reminders, tasks, whatsapp_connections,
 *                    tenant_whatsapp_connections, tenant_member_phones
 * Escreve .......... scheduled_reminders, notifications
 * Chama ............ function whatsapp-send (server-to-server)
 * Variáveis ........ INTERNAL_FUNCTION_SECRET, APPWRITE_API_KEY
 *
 * ─── O QUE MUDOU EM RELAÇÃO AO ORIGINAL ───────────────────────────────
 *
 * 1. QUEM PRODUZ A FILA. No Postgres, os triggers `tasks_reminders_sync_trg` e
 *    `task_reminders_expand_trg` mantinham `scheduled_reminders` em dia a cada
 *    escrita. O Appwrite não tem triggers de banco: essa produção passou para
 *    `process-recurring-schedules` (mesmo cron de 5 min), que porta
 *    compute_reminder_scheduled_at / sync_task_auto_reminders /
 *    expand_task_reminder. Esta function é só a CONSUMIDORA da fila.
 *
 * 2. CANCELAMENTO POR TAREFA CONCLUÍDA. O ramo de `sync_task_auto_reminders`
 *    que cancelava a fila quando a tarefa virava completed/eliminated não tem
 *    onde rodar (era trigger no UPDATE de tasks). Reproduzido aqui, no momento
 *    da entrega: antes de mandar qualquer coisa conferimos a tarefa; se ela
 *    sumiu ou está em status terminal, o item vira 'cancelled'. É o ponto mais
 *    barato para essa checagem — só toca as tarefas dos lembretes vencidos.
 *
 * 3. IDEMPOTÊNCIA (cron a cada 5 min não pode mandar duas vezes). O original
 *    entregava e SÓ DEPOIS marcava 'sent' — uma execução que travasse no meio,
 *    ou duas sobrepostas, reenviavam a mesma mensagem. Aqui o item é RESERVADO
 *    antes da entrega: status vai para 'sent' com sent_at ainda nulo e attempts
 *    incrementado. Como a varredura filtra status='pending', outra execução
 *    simplesmente não o enxerga. Confirmada a entrega, grava-se sent_at; se a
 *    entrega falhar, volta para 'pending' (ou 'failed' no 3º attempt),
 *    exatamente como no original. Efeito colateral aceito: uma queda no meio da
 *    entrega deixa o item 'sent' sem sent_at — erra para o lado de NÃO enviar
 *    de novo, e o par (status=sent, sent_at=null) identifica o caso.
 *
 * 4. WHATSAPP. O original falava direto com a Evolution API. Aqui passa por
 *    `whatsapp-send`, único ponto que conhece a Evolution e que agora exige
 *    x-internal-secret (ver MIGRATION.md, "falhas de segurança corrigidas").
 *
 * 5. LOTE E TIMEOUT. `timeout: 60` no appwrite.json. O lote é limitado e a
 *    execução respeita um orçamento de tempo: o que não couber fica 'pending'
 *    e sai no tique seguinte, sem risco de ser morto no meio de uma entrega.
 */
import { db, Query } from '../_shared/appwrite.js';
import { invokeInternal } from '../_shared/invoke.js';
import { body, err, isScheduled } from '../_shared/http.js';

const LOTE_MAX = 200;            // mesmo teto do original
const ORCAMENTO_MS = 45_000;     // timeout declarado é 60s; sobra para o fecho
const MAX_ATTEMPTS = 3;          // igual ao original
const STATUS_TERMINAL_TAREFA = ['completed', 'eliminated'];

/** Rótulo por tipo de lembrete — cópia do labelFor() do original. */
function rotuloDe(kind) {
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

/** payload era jsonb; no Appwrite é string(65535). */
function lerPayload(bruto) {
  if (!bruto) return {};
  if (typeof bruto === 'object') return bruto;
  try { return JSON.parse(bruto) || {}; } catch { return {}; }
}

/** Cache de leitura por execução: a mesma conexão serve vários lembretes. */
function memo(carregar) {
  const cache = new Map();
  return async (chave) => {
    if (!cache.has(chave)) cache.set(chave, await carregar(chave));
    return cache.get(chave);
  };
}

/**
 * notifications é 'server-doc': o servidor escreve, o dono só lê.
 * Espelha serverWritesUserReads() de src/integrations/appwrite/permissions.ts.
 */
const permissoesNotificacao = (userId) => [`read("user:${userId}")`];

/**
 * Mesmo formato de mensagem do original: *título* em negrito + corpo.
 *
 * Manda o `instance_token` — no Evolution GO é ELE que identifica a instância
 * (não há nome no path). O documento da conexão já foi carregado aqui, então
 * passar o token evita as duas leituras que o `whatsapp-send` faria para
 * resolver o nome pelo caminho de compatibilidade.
 */
function enviarWhatsapp(conexao, phoneNumber, titulo, corpo) {
  return invokeInternal('whatsapp-send', {
    instance_token: conexao.instance_token,
    instance_name: conexao.instance_name, // fallback se o token ainda não foi gravado
    phone_number: phoneNumber,
    message: `*${titulo}*\n${corpo}`,
  });
}

export default async ({ req, res, log, error }) => {
  const inicio = Date.now();
  try {
    if (!isScheduled(req)) {
      const segredo = process.env.INTERNAL_FUNCTION_SECRET;
      // Sem o segredo configurado, `undefined === undefined` liberaria a
      // execução para qualquer um — daí a checagem explícita.
      if (!segredo || req.headers['x-internal-secret'] !== segredo) {
        return res.json({ ok: false, error: 'somente execução agendada' }, 403);
      }
    }

    const entrada = body(req);
    const limite = Math.min(Number(entrada.limite) > 0 ? Number(entrada.limite) : LOTE_MAX, LOTE_MAX);
    const agora = new Date().toISOString();

    const lote = await db.listAll('scheduled_reminders', [
      Query.equal('status', 'pending'),
      Query.lessThanEqual('scheduled_at', agora),
      Query.orderAsc('scheduled_at'),
    ], 100, limite);

    // Estado das tarefas em lote (substitui o EXISTS que a RLS fazia por linha).
    const tarefas = await db.loadRelated('tasks', lote.map((i) => i.task_id));

    const conexaoPessoal = memo((userId) =>
      db.findOne('whatsapp_connections', [Query.equal('user_id', userId)]));
    const conexaoTenant = memo((tenantId) =>
      db.findOne('tenant_whatsapp_connections', [Query.equal('tenant_id', tenantId)]));
    const telefoneTenant = memo((chave) => {
      const [tenantId, userId] = chave.split('|');
      return db.findOne('tenant_member_phones', [
        Query.equal('tenant_id', tenantId),
        Query.equal('user_id', userId),
      ]);
    });

    let enviados = 0, falhos = 0, pulados = 0, cancelados = 0, processados = 0;

    for (const item of lote) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        log(`dispatch-reminders: orçamento de tempo esgotado; ${lote.length - processados} ficam para o próximo tique`);
        break;
      }
      processados++;

      // (2) tarefa concluída/eliminada/apagada -> não entrega nada.
      if (item.task_id) {
        const tarefa = tarefas.get(item.task_id);
        if (!tarefa || STATUS_TERMINAL_TAREFA.includes(tarefa.status)) {
          await db.update('scheduled_reminders', item.$id, {
            status: 'cancelled',
            last_error: tarefa ? `tarefa_${tarefa.status}` : 'tarefa_inexistente',
          });
          cancelados++;
          continue;
        }
      }

      const tentativas = (item.attempts ?? 0) + 1;

      // (3) reserva antes de entregar.
      try {
        await db.update('scheduled_reminders', item.$id, {
          status: 'sent', sent_at: null, attempts: tentativas,
        });
      } catch (e) {
        error(`dispatch-reminders: não consegui reservar ${item.$id}: ${e.message}`);
        continue;
      }

      const pular = async (motivo) => {
        await db.update('scheduled_reminders', item.$id, {
          status: 'skipped', sent_at: null, last_error: motivo,
        });
        pulados++;
      };

      try {
        const payload = lerPayload(item.payload);
        const titulo = rotuloDe(item.kind);
        const corpo = payload.task_title ?? payload.body ?? '';

        if (item.channel === 'in_app' || item.channel === 'browser') {
          // 'browser' continua sendo entregue como in_app: o cliente assina o
          // realtime de notifications e dispara a notificação do navegador.
          await db.create('notifications', {
            user_id: item.user_id,
            type: `reminder_${item.kind}`.slice(0, 50),
            title: titulo.slice(0, 255),
            body: String(corpo).slice(0, 5000),
            metadata: JSON.stringify({
              task_id: item.task_id, scheduled_reminder_id: item.$id, kind: item.kind,
            }),
            read: false,
          }, permissoesNotificacao(item.user_id));

        } else if (item.channel === 'whatsapp_personal') {
          const conn = await conexaoPessoal(item.user_id);
          if (!conn || conn.status !== 'connected' || !conn.phone_number || !conn.reminders_enabled) {
            await pular('no_personal_whatsapp'); continue;
          }
          await enviarWhatsapp(conn, conn.phone_number, titulo, corpo);

        } else if (item.channel === 'whatsapp_tenant') {
          if (!item.tenant_id) { await pular('no_tenant'); continue; }

          const tconn = await conexaoTenant(item.tenant_id);
          if (!tconn || tconn.status !== 'connected' || !tconn.reminders_enabled) {
            await pular('tenant_wa_unavailable'); continue;
          }
          const fone = await telefoneTenant(`${item.tenant_id}|${item.user_id}`);
          if (!fone || !fone.verified || !fone.receive_reminders) {
            await pular('phone_not_verified'); continue;
          }
          await enviarWhatsapp(tconn, fone.phone_number, titulo, corpo);

        } else if (item.channel === 'email') {
          // Sem infraestrutura de e-mail nas functions — igual ao original.
          await pular('email_not_configured'); continue;

        } else {
          await pular(`canal_desconhecido:${item.channel}`); continue;
        }

        // Confirma a reserva: sent_at é o que distingue entregue de reservado.
        await db.update('scheduled_reminders', item.$id, {
          status: 'sent', sent_at: new Date().toISOString(), last_error: null,
        });
        enviados++;
      } catch (e) {
        // Desfaz a reserva: volta para a fila ou desiste no 3º attempt.
        const novoStatus = tentativas >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await db.update('scheduled_reminders', item.$id, {
          status: novoStatus,
          sent_at: null,
          last_error: String(e?.message ?? e).slice(0, 500),
        }).catch((e2) => error(`dispatch-reminders: falha ao registrar erro de ${item.$id}: ${e2.message}`));
        falhos++;
      }
    }

    log(`dispatch-reminders: ${processados}/${lote.length} processados — ${enviados} enviados, ${falhos} falhos, ${pulados} pulados, ${cancelados} cancelados`);
    return res.json({
      ok: true,
      processed: processados,
      sent: enviados,
      failed: falhos,
      skipped: pulados,
      cancelled: cancelados,
      restantes: Math.max(0, lote.length - processados),
    });
  } catch (e) {
    error(`dispatch-reminders: ${e.message}`);
    return err(res, e);
  }
};
