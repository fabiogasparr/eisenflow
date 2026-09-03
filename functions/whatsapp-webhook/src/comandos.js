/**
 * whatsapp-webhook / comandos slash
 * ──────────────────────────────────────────────────────────────────────
 * Caminho determinístico (sem IA) do original: /nova, /listar, /concluir,
 * /andamento, /urgente, /delegar, /membros, /relatorio, /ajuda.
 * Mantido tal e qual — é o plano B quando a IA está fora do ar.
 */
import { db, Query } from '../_shared/appwrite.js';
import {
  STATUS_ABERTOS, permissoesDaTarefa, tarefasDoUsuario, membrosDoTime,
  EMOJI_QUADRANTE, EMOJI_STATUS,
} from './dados.js';
import { delegar } from './ia.js';

/** Os comandos usam 15 tarefas; a IA usa 20. É a diferença do original. */
const LIMITE = 15;

const fmtData = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export async function processarComando(mensagem, userId, log) {
  const comando = mensagem.trim();
  const partes = comando.split(' ');
  const cmd = partes[0].toLowerCase();
  const args = partes.slice(1).join(' ');

  if (cmd === '/nova' || cmd === '/new') {
    if (!args) return '⚠️ Use: /nova Título da tarefa';
    await db.create('tasks', {
      title: args, created_by: userId, quadrant: 'do', status: 'pending', tags: [],
    }, permissoesDaTarefa({ createdBy: userId }));
    return `✅ Tarefa criada: *${args}*`;
  }

  if (cmd === '/listar' || cmd === '/list') {
    const tarefas = await tarefasDoUsuario(userId, LIMITE);
    if (!tarefas.length) return '📋 Nenhuma tarefa pendente!';
    return `📋 *Suas tarefas:*\n\n${tarefas.map((t, i) =>
      `${i + 1}. ${EMOJI_STATUS[t.status] || ''} ${EMOJI_QUADRANTE[t.quadrant] || ''} ${t.title}`).join('\n')}`;
  }

  if (['/concluir', '/done', '/andamento', '/progress', '/urgente', '/urgent'].includes(cmd)) {
    const i = parseInt(args, 10) - 1;
    if (isNaN(i) || i < 0) return `⚠️ Use: ${cmd} [número]`;
    const tarefas = await tarefasDoUsuario(userId, LIMITE);
    const t = tarefas[i];
    if (!t) return '❌ Tarefa não encontrada';

    if (cmd === '/concluir' || cmd === '/done') {
      await db.update('tasks', t.$id, { status: 'completed', completed_at: new Date().toISOString() });
      return `✅ Tarefa concluída: *${t.title}*`;
    }
    if (cmd === '/andamento' || cmd === '/progress') {
      await db.update('tasks', t.$id, { status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' });
      return `🔄 Em andamento: *${t.title}*`;
    }
    await db.update('tasks', t.$id, { quadrant: 'do', urgency: 5, importance: 5 });
    return `🔴 Movida para "Fazer Agora": *${t.title}*`;
  }

  if (cmd === '/delegar' || cmd === '/delegate') {
    const i = parseInt(partes[1], 10) - 1;
    const busca = partes.slice(2).join(' ').trim();
    if (isNaN(i) || i < 0 || !busca) return '⚠️ Use: /delegar [número] [nome do membro]\nEx: /delegar 1 João';

    const tarefas = await tarefasDoUsuario(userId, LIMITE);
    const t = tarefas[i];
    if (!t) return '❌ Tarefa não encontrada';

    const membros = await membrosDoTime(userId);
    if (!membros.length) return '❌ Nenhum membro encontrado nos seus times.';
    const achado = membros.find((p) => (p.display_name || '').toLowerCase().includes(busca.toLowerCase()));
    if (!achado) {
      return `❌ Membro "${busca}" não encontrado.\n\n👥 *Membros disponíveis:* ${membros.map((p) => p.display_name).join(', ') || 'nenhum'}`;
    }
    return delegar(t, achado, userId, log);
  }

  if (cmd === '/membros' || cmd === '/members') {
    const meus = await db.list('team_members', [Query.equal('user_id', userId), Query.limit(100)]);
    const teamIds = (meus.documents || []).map((m) => m.team_id);
    if (!teamIds.length) return '❌ Você não pertence a nenhum time.';

    const [times, todos] = await Promise.all([
      db.loadRelated('teams', teamIds),
      db.list('team_members', [Query.equal('team_id', teamIds), Query.limit(500)]),
    ]);
    const membros = todos.documents || [];
    const perfis = await db.list('profiles', [
      Query.equal('user_id', [...new Set(membros.map((m) => m.user_id))]), Query.limit(500),
    ]);
    const nomePorUsuario = new Map((perfis.documents || []).map((p) => [p.user_id, p.display_name || 'Sem nome']));
    const emojiPapel = { admin: '👑', manager: '⭐', member: '👤' };

    const grupos = {};
    for (const m of membros) {
      const nomeTime = times.get(m.team_id)?.name || 'Time';
      (grupos[nomeTime] ||= []).push(
        `${emojiPapel[m.role] || '👤'} ${nomePorUsuario.get(m.user_id) || 'Sem nome'}${m.user_id === userId ? ' (você)' : ''}`);
    }

    let saida = '👥 *Seus times e membros:*\n';
    for (const [nomeTime, lista] of Object.entries(grupos)) saida += `\n📌 *${nomeTime}*\n${lista.join('\n')}\n`;
    return saida;
  }

  if (cmd === '/relatorio' || cmd === '/report') {
    const tipo = args.trim().toLowerCase();
    const diario = ['diario', 'diário', 'daily', 'dia', 'hoje'].includes(tipo);
    return diario ? relatorioDiario(userId) : relatorioSemanal(userId);
  }

  if (cmd === '/ajuda' || cmd === '/help') {
    return '📖 *Comandos disponíveis:*\n\n' +
      '/nova [título] - Criar tarefa\n' +
      '/listar - Listar tarefas\n' +
      '/concluir [nº] - Concluir tarefa\n' +
      '/andamento [nº] - Marcar em andamento\n' +
      '/urgente [nº] - Mover para "Fazer Agora"\n' +
      '/delegar [nº] [nome] - Delegar tarefa\n' +
      '/membros - Listar membros dos times\n' +
      '/relatorio - Relatório semanal\n' +
      '/relatorio diario - Relatório diário\n' +
      '/ajuda - Este menu\n\n' +
      '💡 *Dica:* Você também pode mandar mensagem em linguagem natural, foto ou áudio! ' +
      'Ex: "cria uma tarefa para revisar o relatório amanhã"';
  }

  return '❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.';
}

// ─────────────────────────────────────────────────────────────── relatórios
async function gamificacao(userId) {
  return db.findOne('gamification', [Query.equal('user_id', userId)]);
}

async function relatorioDiario(userId) {
  const agora = new Date();
  const [tarefas, gamif] = await Promise.all([
    db.listAll('tasks', [Query.equal('created_by', userId)], 100, 2000),
    gamificacao(userId),
  ]);
  return montarRelatorioDiario({ tarefas, gamif, agora, dica: false });
}

async function relatorioSemanal(userId) {
  const agora = new Date();
  const semanaAtras = new Date(agora.getTime() - 7 * 864e5);
  const iso = semanaAtras.toISOString();

  const [concluidas, criadas, metricas, abertas, gamif] = await Promise.all([
    db.listAll('tasks', [Query.equal('created_by', userId), Query.equal('status', 'completed'), Query.greaterThanEqual('completed_at', iso)], 100, 1000),
    db.listAll('tasks', [Query.equal('created_by', userId), Query.greaterThanEqual('created_at', iso)], 100, 1000),
    db.listAll('productivity_metrics', [Query.equal('user_id', userId), Query.greaterThanEqual('date', iso.split('T')[0])], 100, 100),
    db.listAll('tasks', [Query.equal('created_by', userId), Query.equal('status', STATUS_ABERTOS)], 100, 1000),
    gamificacao(userId),
  ]);

  return montarRelatorioSemanal({ concluidas, criadas, metricas, abertas, gamif, agora, semanaAtras });
}

function montarRelatorioSemanal({ concluidas, criadas, metricas, abertas, gamif, agora, semanaAtras }) {
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

function montarRelatorioDiario({ tarefas, gamif, agora, dica = true }) {
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
  if (dica) r += '\n💡 _Envie /listar para ver suas tarefas_';
  return r;
}
