/**
 * Relatórios diário e semanal de produtividade em texto de WhatsApp.
 *
 * Compartilhado por `whatsapp-report` (cron) e pelo comando `/relatorio` do
 * `whatsapp-webhook` — no código original a mesma montagem existia duas vezes,
 * com pequenas divergências. Aqui há uma só.
 */
import { admin } from './supabase.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const STATUS_ABERTOS = ['pending', 'in_progress'];

export const fmtData = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

async function gamificacao(userId: string): Promise<Row | null> {
  const { data } = await admin().from('gamification').select('*').eq('user_id', userId).maybeSingle();
  return data ?? null;
}

// ───────────────────────────────────────────────────────────────── diário
export async function relatorioDiario(userId: string, agora = new Date(), dica = true): Promise<string> {
  const db = admin();
  const [{ data: tarefas }, gamif] = await Promise.all([
    db.from('tasks').select('title, due_date, status').eq('created_by', userId).limit(2000),
    gamificacao(userId),
  ]);
  const lista: Row[] = tarefas ?? [];

  const conta = (s: string) => lista.filter((t) => t.status === s).length;
  const emUmaSemana = new Date(agora.getTime() + 7 * 864e5);
  const proximas = lista
    .filter((t) => t.due_date && !['completed', 'eliminated'].includes(t.status))
    .filter((t) => { const d = new Date(t.due_date); return d >= agora && d <= emUmaSemana; })
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
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

// ──────────────────────────────────────────────────────────────── semanal
export async function relatorioSemanal(userId: string, agora = new Date()): Promise<string> {
  const db = admin();
  const semanaAtras = new Date(agora.getTime() - 7 * 864e5);
  const iso = semanaAtras.toISOString();

  const [concluidasQ, criadasQ, metricasQ, abertasQ, gamif] = await Promise.all([
    db.from('tasks').select('quadrant').eq('created_by', userId).eq('status', 'completed').gte('completed_at', iso).limit(1000),
    db.from('tasks').select('id').eq('created_by', userId).gte('created_at', iso).limit(1000),
    db.from('productivity_metrics').select('*').eq('user_id', userId).gte('date', iso.split('T')[0]).limit(100),
    db.from('tasks').select('title, due_date').eq('created_by', userId).in('status', STATUS_ABERTOS).limit(1000),
    gamificacao(userId),
  ]);
  const concluidas: Row[] = concluidasQ.data ?? [];
  const criadas: Row[] = criadasQ.data ?? [];
  const metricas: Row[] = metricasQ.data ?? [];
  const abertas: Row[] = abertasQ.data ?? [];

  const soma = (campo: string) => metricas.reduce((s, m) => s + (m[campo] || 0), 0);
  const pomodoros = soma('pomodoros_completed');
  const foco = soma('time_in_important');
  const delegadas = soma('tasks_delegated');
  const eliminadas = soma('tasks_eliminated');

  const porQuadrante: Record<string, number> = { do: 0, schedule: 0, delegate: 0, eliminate: 0 };
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
