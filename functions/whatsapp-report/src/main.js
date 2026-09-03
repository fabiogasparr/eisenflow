/**
 * whatsapp-report
 * ──────────────────────────────────────────────────────────────────────
 * Cron de hora em hora: monta e envia o relatório diário/semanal de
 * produtividade para quem habilitou, no horário do FUSO DO USUÁRIO.
 *
 * Origem: supabase/functions/whatsapp-report/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .......... cron 0 * * * *  (timeout 60s — ver appwrite.json)
 * Autenticação ..... execução agendada ou x-internal-secret
 * Entrada .......... { type?: 'daily' | 'weekly' } — sem o campo, roda os dois
 * Saída ............ { ok, daily, weekly }
 * Lê ............... whatsapp_connections, tasks, productivity_metrics, gamification
 * Escreve .......... nenhuma
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET, APPWRITE_API_KEY
 *
 * MUDANÇAS EM RELAÇÃO AO ORIGINAL:
 *  1. FUSO. O original tinha UTC-3 fixo no código: quem estivesse em Lisboa ou
 *     Manaus recebia o "relatório das 08:00" na hora errada. Agora o corte usa
 *     Intl.DateTimeFormat com whatsapp_connections.timezone.
 *  2. Uma execução cobre diário E semanal. No original só existia um cron e o
 *     semanal dependia de alguém mandar {type:'weekly'} no corpo — ou seja,
 *     nunca saía sozinho.
 *  3. Envio por evolution.sendText(instance_token, ...): na Evolution GO a
 *     instância é identificada pelo token, não pelo nome no caminho.
 *
 * PENDENTE: tenant_whatsapp_connections também tem daily/weekly_report_enabled,
 * mas não tem user_id nem report_time — não há de quem fazer o relatório. Fica
 * como estava no original: só conexões pessoais.
 */
import { db, Query } from '../_shared/appwrite.js';
import { evolution } from '../_shared/evolution.js';
import { body, err, isScheduled } from '../_shared/http.js';

const FUSO_PADRAO = 'America/Sao_Paulo';
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hora e dia da semana no fuso do usuário — sem dependência de data externa. */
function localDe(tz, agora) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false, weekday: 'short' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_PADRAO, hour: '2-digit', hour12: false, weekday: 'short' });
  }
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]));
  return { hora: Number(p.hour) % 24, diaSemana: DIAS[p.weekday] ?? 1 };
}

const horaDe = (hhmmss, padrao = 8) => {
  const h = parseInt(String(hhmmss || '').split(':')[0], 10);
  return Number.isNaN(h) ? padrao : h;
};

const fmtData = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export default async ({ req, res, log, error }) => {
  try {
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    const pedido = body(req).type;
    const tipos = pedido ? [pedido] : ['daily', 'weekly'];
    const agora = new Date();
    const resultado = { ok: true, daily: 0, weekly: 0 };

    for (const tipo of tipos) {
      const campo = tipo === 'weekly' ? 'weekly_report_enabled' : 'daily_report_enabled';
      const conexoes = await db.listAll('whatsapp_connections', [
        Query.equal('status', 'connected'), Query.equal(campo, true),
      ], 100, 1000);

      const alvos = conexoes.filter((c) => {
        const { hora, diaSemana } = localDe(c.timezone || FUSO_PADRAO, agora);
        if (tipo === 'weekly') {
          return horaDe(c.weekly_report_time || c.report_time) === hora && (c.weekly_report_day ?? 1) === diaSemana;
        }
        return horaDe(c.report_time) === hora;
      });

      log(`whatsapp-report: ${tipo} — ${alvos.length} de ${conexoes.length} conexões no horário`);

      for (const conn of alvos) {
        if (!conn.phone_number || !conn.instance_token) {
          log(`whatsapp-report: conexão ${conn.$id} sem número ou token, pulando`);
          continue;
        }
        try {
          const texto = tipo === 'weekly'
            ? await relatorioSemanal(conn.user_id, agora)
            : await relatorioDiario(conn.user_id, agora);
          await evolution.sendText(conn.instance_token, conn.phone_number, texto);
          resultado[tipo]++;
        } catch (e) {
          error(`whatsapp-report: falhou para ${conn.user_id}: ${e.message}`);
        }
      }
    }

    return res.json(resultado);
  } catch (e) {
    error(`whatsapp-report: ${e.message}`);
    return err(res, e);
  }
};

// ───────────────────────────────────────────────────────────────── diário
async function relatorioDiario(userId, agora) {
  const [tarefas, gamif] = await Promise.all([
    db.listAll('tasks', [Query.equal('created_by', userId)], 100, 2000),
    db.findOne('gamification', [Query.equal('user_id', userId)]),
  ]);

  const conta = (s) => tarefas.filter((t) => t.status === s).length;
  const emUmaSemana = new Date(agora.getTime() + 7 * 864e5);
  const proximas = tarefas
    .filter((t) => t.due_date && !['completed', 'eliminated'].includes(t.status))
    .filter((t) => { const d = new Date(t.due_date); return d >= agora && d <= emUmaSemana; })
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 5);

  let r = `📊 *Relatório Diário - ${fmtData(agora)}*\n\n`;
  r += `✅ *Concluídas:* ${conta('completed')} tarefas\n`;
  r += `🔄 *Em andamento:* ${conta('in_progress')} tarefas\n`;
  r += `⏳ *Pendentes:* ${conta('pending')} tarefas\n`;
  if (proximas.length) {
    r += '\n🔥 *Próximos prazos:*\n';
    for (const t of proximas) {
      const dias = Math.ceil((new Date(t.due_date).getTime() - agora.getTime()) / 864e5);
      r += `• ${t.title} - ${dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`}\n`;
    }
  }
  if (gamif) {
    r += `\n🍅 *Pomodoros:* ${gamif.total_pomodoros} completados\n`;
    r += `🏆 *Nível:* ${gamif.level} (${(gamif.xp || 0).toLocaleString('pt-BR')} XP)\n`;
    if (gamif.current_streak > 0) r += `🔥 *Streak:* ${gamif.current_streak} dias\n`;
  }
  r += '\n💡 _Envie /listar para ver suas tarefas_';
  return r;
}

// ──────────────────────────────────────────────────────────────── semanal
async function relatorioSemanal(userId, agora) {
  const semanaAtras = new Date(agora.getTime() - 7 * 864e5);
  const iso = semanaAtras.toISOString();

  const [concluidas, criadas, metricas, abertas, gamif] = await Promise.all([
    db.listAll('tasks', [Query.equal('created_by', userId), Query.equal('status', 'completed'), Query.greaterThanEqual('completed_at', iso)], 100, 1000),
    db.listAll('tasks', [Query.equal('created_by', userId), Query.greaterThanEqual('created_at', iso)], 100, 1000),
    db.listAll('productivity_metrics', [Query.equal('user_id', userId), Query.greaterThanEqual('date', iso.split('T')[0])], 100, 100),
    db.listAll('tasks', [Query.equal('created_by', userId), Query.equal('status', ['pending', 'in_progress'])], 100, 1000),
    db.findOne('gamification', [Query.equal('user_id', userId)]),
  ]);

  const soma = (campo) => metricas.reduce((s, m) => s + (m[campo] || 0), 0);
  const pomodoros = soma('pomodoros_completed');
  const foco = soma('time_in_important');
  const delegadas = soma('tasks_delegated');
  const eliminadas = soma('tasks_eliminated');

  const porQuadrante = { do: 0, schedule: 0, delegate: 0, eliminate: 0 };
  for (const t of concluidas) porQuadrante[t.quadrant] = (porQuadrante[t.quadrant] || 0) + 1;

  const atrasadas = abertas.filter((t) => t.due_date && new Date(t.due_date) < agora);
  const linha = '━━━━━━━━━━━━━━━━━━━━━\n';

  let r = '📊 *Relatório Semanal de Produtividade*\n';
  r += `📅 ${fmtData(semanaAtras)} a ${fmtData(agora)}\n\n`;
  r += linha + '📈 *Resumo Geral*\n';
  r += `✅ Tarefas concluídas: *${concluidas.length}*\n`;
  r += `📝 Tarefas criadas: *${criadas.length}*\n`;
  r += `⏳ Tarefas pendentes: *${abertas.length}*\n`;
  if (atrasadas.length) r += `🚨 Tarefas atrasadas: *${atrasadas.length}*\n`;
  r += '\n' + linha + '🎯 *Por Quadrante (concluídas)*\n';
  r += `🔴 Fazer Agora: ${porQuadrante.do}\n🔵 Agendar: ${porQuadrante.schedule}\n`;
  r += `🟡 Delegar: ${porQuadrante.delegate}\n⚪ Eliminar: ${porQuadrante.eliminate}\n\n`;

  if (pomodoros > 0 || foco > 0) {
    r += linha + '🍅 *Foco & Pomodoros*\n';
    r += `🍅 Pomodoros: *${pomodoros}*\n`;
    const h = Math.floor(foco / 60); const m = foco % 60;
    r += `⏱️ Tempo de foco: *${h > 0 ? h + 'h ' : ''}${m}min*\n\n`;
  }
  if (delegadas > 0 || eliminadas > 0) r += `🤝 Delegadas: ${delegadas} | 🗑️ Eliminadas: ${eliminadas}\n\n`;

  if (gamif) {
    r += linha + '🏆 *Gamificação*\n';
    r += `⭐ Nível ${gamif.level} | ${gamif.xp} XP\n`;
    r += `🔥 Streak: ${gamif.current_streak} dias (recorde: ${gamif.longest_streak})\n\n`;
  }

  if (atrasadas.length) {
    r += linha + '🚨 *Tarefas Atrasadas*\n';
    for (const t of atrasadas.slice(0, 5)) r += `• ${t.title} (${fmtData(new Date(t.due_date))})\n`;
    if (atrasadas.length > 5) r += `... e mais ${atrasadas.length - 5}\n`;
    r += '\n';
  }

  const score = concluidas.length ? Math.min(100, Math.round((concluidas.length / Math.max(criadas.length, 1)) * 100)) : 0;
  r += linha + `${score >= 80 ? '🌟' : score >= 50 ? '👍' : '💪'} *Taxa de conclusão: ${score}%*\n`;
  r += score >= 80 ? 'Excelente semana! Continue assim! 🚀'
    : score >= 50 ? 'Boa semana! Foque nas tarefas importantes. 🎯'
    : 'Semana desafiadora. Que tal revisar suas prioridades? 📋';
  return r;
}
