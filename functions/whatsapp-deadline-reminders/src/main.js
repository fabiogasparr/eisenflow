/**
 * whatsapp-deadline-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Cron a cada 15 min: avisa por WhatsApp as tarefas vencendo agora, na
 * próxima 1h e nas próximas 24h — respeitando o horário e o fuso de cada
 * usuário, e sem repetir aviso já enviado.
 *
 * Origem: supabase/functions/whatsapp-deadline-reminders/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .......... cron *\/15 * * * *  (timeout 60s — ver appwrite.json)
 * Autenticação ..... execução agendada ou x-internal-secret
 * Entrada .......... nenhuma
 * Saída ............ { ok, sent }
 * Lê ............... whatsapp_connections, tasks, whatsapp_sent_reminders
 * Escreve .......... whatsapp_sent_reminders (e limpa as antigas)
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET, APPWRITE_API_KEY
 *
 * O QUE IMPEDE O REENVIO: o índice único (user_id, task_id, reminder_type) de
 * whatsapp_sent_reminders. Não existe upsert no Appwrite — gravamos e tratamos
 * o 409 como "já avisado", que é a resposta certa.
 *
 * MUDANÇAS EM RELAÇÃO AO ORIGINAL:
 *  - O original convertia fuso com `new Date(now.toLocaleString('en-US', {timeZone}))`,
 *    que depende do parser de data do runtime e erra em fusos com meia hora de
 *    offset. Aqui a hora local vem de Intl.DateTimeFormat.
 *  - O fallback "busca o telefone na Evolution" saiu: a Evolution GO não expõe o
 *    dono da instância. Quem preenche phone_number é o whatsapp-webhook, na
 *    primeira mensagem própria que chega.
 *  - Envio por evolution.sendText(instance_token, ...) — a instância é o token.
 */
import { db, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';
import { evolution } from '../_shared/evolution.js';
import { err, isScheduled } from '../_shared/http.js';

const FUSO_PADRAO = 'America/Sao_Paulo';
const TOLERANCIA_MIN = 30;

/** whatsapp_sent_reminders não tem updated_at; db.create carimbaria e o Appwrite recusaria. */
const registrarEnvio = (data) =>
  rawCall('POST', `/databases/${DATABASE_ID}/collections/whatsapp_sent_reminders/documents`, {
    documentId: 'unique()', data,
  });

/** Minutos desde a meia-noite no fuso do usuário. */
function minutosLocais(tz, agora) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_PADRAO, hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** O usuário configura "08:00,12:00,18:00"; ±30 min é a janela do original. */
function estaNaJanela(reminderTimes, minutosAgora) {
  const horarios = String(reminderTimes || '08:00,12:00,18:00').split(',').map((t) => t.trim()).filter(Boolean);
  return horarios.some((t) => {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h)) return false;
    const alvo = h * 60 + (m || 0);
    const diff = Math.abs(minutosAgora - alvo);
    return diff <= TOLERANCIA_MIN || diff >= 24 * 60 - TOLERANCIA_MIN; // vira a meia-noite
  });
}

export default async ({ req, res, log, error }) => {
  try {
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    limparAntigos().catch((e) => error(`limpeza falhou: ${e.message}`));

    const conexoes = await db.listAll('whatsapp_connections', [
      Query.equal('status', 'connected'), Query.equal('reminders_enabled', true),
    ], 100, 1000);
    log(`whatsapp-deadline-reminders: ${conexoes.length} conexões com lembretes ligados`);

    const agora = new Date();
    const em24h = new Date(agora.getTime() + 24 * 3600e3);
    let enviados = 0;

    for (const conn of conexoes) {
      const minutos = minutosLocais(conn.timezone || FUSO_PADRAO, agora);
      if (!estaNaJanela(conn.reminder_times, minutos)) continue;
      if (!conn.phone_number || !conn.instance_token) {
        log(`whatsapp-deadline-reminders: conexão ${conn.$id} sem número ou token, pulando`);
        continue;
      }

      try {
        const enviou = await avisar(conn, agora, em24h, log);
        if (enviou) enviados++;
      } catch (e) {
        error(`whatsapp-deadline-reminders: falhou para ${conn.user_id}: ${e.message}`);
      }
    }

    log(`whatsapp-deadline-reminders: ${enviados} avisos enviados`);
    return res.json({ ok: true, sent: enviados });
  } catch (e) {
    error(`whatsapp-deadline-reminders: ${e.message}`);
    return err(res, e);
  }
};

async function avisar(conn, agora, em24h, log) {
  // Tarefas do usuário (criadas por ele OU atribuídas a ele) vencendo até 24h.
  const tarefas = await db.listAll('tasks', [
    Query.or([Query.equal('created_by', conn.user_id), Query.equal('assigned_to', conn.user_id)]),
    Query.equal('status', ['pending', 'in_progress']),
    Query.isNotNull('due_date'),
    Query.greaterThanEqual('due_date', agora.toISOString()),
    Query.lessThanEqual('due_date', em24h.toISOString()),
    Query.orderAsc('due_date'),
  ], 100, 500);
  if (!tarefas.length) return false;

  // Quais já foram avisados — a consulta evita 1 escrita perdida por tarefa.
  const jaEnviados = await db.listAll('whatsapp_sent_reminders', [
    Query.equal('user_id', conn.user_id),
    Query.equal('task_id', tarefas.slice(0, 100).map((t) => t.$id)),
  ], 100, 500);
  const enviado = new Set(jaEnviados.map((r) => `${r.task_id}:${r.reminder_type}`));

  const grupos = { now: [], '1h': [], '24h': [] };
  for (const t of tarefas) {
    const falta = new Date(t.due_date).getTime() - agora.getTime();
    const tipo = falta <= 0 ? 'now' : falta <= 3600e3 ? '1h' : '24h';
    if (enviado.has(`${t.$id}:${tipo}`)) continue;
    grupos[tipo].push(t);
  }

  const total = grupos.now.length + grupos['1h'].length + grupos['24h'].length;
  if (!total) return false;

  const linhas = ['⏰ *Lembretes de Prazo*\n'];
  const bloco = (titulo, lista) => {
    if (!lista.length) return;
    linhas.push(titulo);
    lista.forEach((t, i) => linhas.push(`  ${i + 1}. ${t.title}`));
    linhas.push('');
  };
  bloco('🔴 *Vencendo agora:*', grupos.now);
  bloco('🟡 *Próxima 1 hora:*', grupos['1h']);
  bloco('🔵 *Próximas 24 horas:*', grupos['24h']);
  linhas.push('Use /listar para ver detalhes.');

  await evolution.sendText(conn.instance_token, conn.phone_number, linhas.join('\n'));
  log(`whatsapp-deadline-reminders: ${total} tarefas avisadas a ${conn.user_id}`);

  // Só marca depois do envio dar certo: falhou o envio, o próximo ciclo tenta de novo.
  const carimbo = new Date().toISOString();
  for (const [tipo, lista] of Object.entries(grupos)) {
    for (const t of lista) {
      await registrarEnvio({ user_id: conn.user_id, task_id: t.$id, reminder_type: tipo, sent_at: carimbo })
        .catch((e) => { if (e?.status !== 409) throw e; }); // 409 = outro ciclo já registrou
    }
  }
  return true;
}

/** Registro de envio serve por 48h; depois é só peso morto na collection. */
async function limparAntigos() {
  const limite = new Date(Date.now() - 48 * 3600e3).toISOString();
  const antigos = await db.list('whatsapp_sent_reminders', [
    Query.lessThan('sent_at', limite), Query.limit(100),
  ]);
  for (const doc of antigos.documents || []) {
    await db.delete('whatsapp_sent_reminders', doc.$id).catch(() => {});
  }
}
