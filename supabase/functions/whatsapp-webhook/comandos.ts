/**
 * whatsapp-webhook / comandos slash
 * ──────────────────────────────────────────────────────────────────────
 * Caminho determinístico (sem IA) do original: /nova, /listar, /concluir,
 * /andamento, /urgente, /delegar, /membros, /relatorio, /ajuda.
 * Mantido tal e qual — é o plano B quando a IA está fora do ar.
 */
import { admin } from '../_shared/supabase.ts';
import { relatorioDiario, relatorioSemanal } from '../_shared/relatorios.ts';
import { type Row, atualizarTarefa, tarefasDoUsuario, membrosDoTime, EMOJI_QUADRANTE, EMOJI_STATUS } from './dados.ts';
import { delegar } from './ia.ts';

/** Os comandos usam 15 tarefas; a IA usa 20. É a diferença do original. */
const LIMITE = 15;

export async function processarComando(mensagem: string, userId: string): Promise<string> {
  const comando = mensagem.trim();
  const partes = comando.split(' ');
  const cmd = partes[0].toLowerCase();
  const args = partes.slice(1).join(' ');
  const db = admin();

  if (cmd === '/nova' || cmd === '/new') {
    if (!args) return '⚠️ Use: /nova Título da tarefa';
    const { error } = await db.from('tasks').insert({ title: args, created_by: userId, quadrant: 'do', status: 'pending' });
    if (error) throw error;
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
      await atualizarTarefa(t.id, { status: 'completed', completed_at: new Date().toISOString() });
      return `✅ Tarefa concluída: *${t.title}*`;
    }
    if (cmd === '/andamento' || cmd === '/progress') {
      await atualizarTarefa(t.id, { status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' });
      return `🔄 Em andamento: *${t.title}*`;
    }
    await atualizarTarefa(t.id, { quadrant: 'do', urgency: 5, importance: 5 });
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
    return delegar(t, achado, userId);
  }

  if (cmd === '/membros' || cmd === '/members') {
    const { data: meus } = await db.from('team_members').select('team_id').eq('user_id', userId).limit(100);
    const teamIds = (meus ?? []).map((m: Row) => m.team_id);
    if (!teamIds.length) return '❌ Você não pertence a nenhum time.';

    const [{ data: times }, { data: todos }] = await Promise.all([
      db.from('teams').select('id, name').in('id', teamIds),
      db.from('team_members').select('team_id, user_id, role').in('team_id', teamIds).limit(500),
    ]);
    const membros: Row[] = todos ?? [];
    const { data: perfis } = await db
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', [...new Set(membros.map((m) => m.user_id))])
      .limit(500);
    const nomeTime = new Map((times ?? []).map((t: Row) => [t.id, t.name]));
    const nomePorUsuario = new Map((perfis ?? []).map((p: Row) => [p.user_id, p.display_name || 'Sem nome']));
    const emojiPapel: Record<string, string> = { admin: '👑', manager: '⭐', member: '👤' };

    const grupos: Record<string, string[]> = {};
    for (const m of membros) {
      const nome = nomeTime.get(m.team_id) || 'Time';
      (grupos[nome] ||= []).push(
        `${emojiPapel[m.role] || '👤'} ${nomePorUsuario.get(m.user_id) || 'Sem nome'}${m.user_id === userId ? ' (você)' : ''}`);
    }

    let saida = '👥 *Seus times e membros:*\n';
    for (const [nome, lista] of Object.entries(grupos)) saida += `\n📌 *${nome}*\n${lista.join('\n')}\n`;
    return saida;
  }

  if (cmd === '/relatorio' || cmd === '/report') {
    const tipo = args.trim().toLowerCase();
    const diario = ['diario', 'diário', 'daily', 'dia', 'hoje'].includes(tipo);
    return diario ? relatorioDiario(userId, new Date(), false) : relatorioSemanal(userId);
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
