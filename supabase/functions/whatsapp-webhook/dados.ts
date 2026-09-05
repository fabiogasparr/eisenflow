/**
 * whatsapp-webhook / acesso a dados
 * ──────────────────────────────────────────────────────────────────────
 * Tudo que o webhook lê e grava no banco, num lugar só, para os comandos
 * slash e o caminho de IA compartilharem as MESMAS consultas — na versão
 * Lovable as duas rotas repetiam a query de tarefas com limites diferentes
 * (20 na IA, 15 nos comandos), e o índice mostrado ao usuário mudava conforme
 * o caminho. Aqui o limite é parâmetro e os dois caminhos usam a mesma ordenação.
 *
 * Todas as escritas usam a service role: as permissões são RLS no Postgres e
 * quem autoriza é o webhook (instância -> user_id), não o documento.
 */
import { admin } from '../_shared/supabase.ts';

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

/** Status que contam como "tarefa viva" — é a lista do original. */
export const STATUS_ABERTOS = ['pending', 'in_progress'];

// ------------------------------------------------------------------ tarefas
export async function tarefasDoUsuario(userId: string, limite = 20): Promise<Row[]> {
  const { data, error } = await admin()
    .from('tasks')
    .select('*')
    .eq('created_by', userId)
    .in('status', STATUS_ABERTOS)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

export async function atualizarTarefa(taskId: string, patch: Row): Promise<void> {
  const { error } = await admin().from('tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

// -------------------------------------------------------------------- times
/** Colegas de time do usuário, já com display_name resolvido. */
export async function membrosDoTime(userId: string): Promise<Row[]> {
  const db = admin();
  const { data: meus } = await db.from('team_members').select('team_id').eq('user_id', userId).limit(100);
  const teamIds = (meus ?? []).map((t: Row) => t.team_id);
  if (!teamIds.length) return [];

  const { data: outros } = await db.from('team_members').select('user_id').in('team_id', teamIds).neq('user_id', userId).limit(200);
  const ids = [...new Set((outros ?? []).map((m: Row) => m.user_id))];
  if (!ids.length) return [];

  const { data: perfis } = await db.from('profiles').select('user_id, display_name').in('user_id', ids).limit(200);
  return (perfis ?? []).filter((p: Row) => p.display_name);
}

export async function perfilDe(userId: string): Promise<Row | null> {
  const { data } = await admin().from('profiles').select('user_id, display_name').eq('user_id', userId).maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------- histórico
export async function historico(userId: string, limite = 10): Promise<Row[]> {
  const { data } = await admin()
    .from('whatsapp_chat_history')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limite);
  return (data ?? []).reverse();
}

export async function salvarMensagem(userId: string, role: string, content: string): Promise<void> {
  const { error } = await admin().from('whatsapp_chat_history').insert({ user_id: userId, role, content });
  if (error) throw error;
}

/** Mantém as últimas N mensagens do usuário; o resto vira lixo de contexto. */
export async function podarHistorico(userId: string, manter = 30): Promise<void> {
  const db = admin();
  const { data } = await db
    .from('whatsapp_chat_history')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(manter, manter + 99);
  const ids = (data ?? []).map((d: Row) => d.id);
  if (ids.length) await db.from('whatsapp_chat_history').delete().in('id', ids);
}

// -------------------------------------------------------------- formatação
export const EMOJI_QUADRANTE: Record<string, string> = { do: '🔴', schedule: '🔵', delegate: '🟡', eliminate: '⚪' };
export const EMOJI_STATUS: Record<string, string> = { pending: '⏳', in_progress: '🔄' };
export const ROTULO_QUADRANTE: Record<string, string> = { do: 'Fazer Agora', schedule: 'Agendar', delegate: 'Delegar', eliminate: 'Eliminar' };
export const ROTULO_STATUS: Record<string, string> = { pending: 'Pendente', in_progress: 'Em andamento' };

export const listarTarefas = (tarefas: Row[]): string =>
  tarefas.map((t, i) =>
    `${i + 1}. ${EMOJI_STATUS[t.status] || ''} ${EMOJI_QUADRANTE[t.quadrant] || ''} ${t.title}` +
    (t.due_date ? ` (📅 ${new Date(t.due_date).toLocaleDateString('pt-BR')})` : '')
  ).join('\n');

/** "amanhã (05/06) às 14:00" — sempre no fuso do usuário, não no do servidor. */
export function formatarQuando(d: Date, tz = 'America/Sao_Paulo'): string {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
  const dia = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: tz });
  const agora = new Date();
  const alvo = dia(d);
  let rel: string;
  if (alvo === dia(agora)) rel = 'hoje';
  else if (alvo === dia(new Date(agora.getTime() + 864e5))) rel = 'amanhã';
  else rel = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: tz });
  return `${rel} (${data}) às ${hora}`;
}
