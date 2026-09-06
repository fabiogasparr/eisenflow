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

// ------------------------------------------------------------------- prazos
/**
 * Deslocamento do fuso NAQUELE instante ("-03:00"). Feito com Intl porque o
 * horário de verão muda o offset e uma constante mentiria metade do ano.
 */
export function offsetDoFuso(quando: Date, tz: string): string {
  try {
    const parte = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(quando).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = parte.match(/GMT([+-]\d{2}:\d{2})/);
    if (m) return m[1];
    if (/^GMT$/.test(parte)) return '+00:00';
  } catch { /* Intl sem ICU: cai no padrão */ }
  return '-03:00';
}

export interface Prazo { iso: string | null; temHora: boolean; original: string }

/**
 * Normaliza o que a IA devolveu em due_date para um instante ABSOLUTO correto.
 *
 * O problema que isto resolve: o modelo escrevia "2026-09-08T09:00:00Z" quando
 * o usuário disse "terça às 9h". Gravado assim, o compromisso caía às 6h da
 * manhã no Brasil — e o usuário via a hora errada na agenda sem entender por quê.
 *
 * Ninguém marca reunião por WhatsApp em UTC: o horário dito é SEMPRE de relógio
 * de parede, no fuso da pessoa. Então:
 *   - com offset explícito (-03:00) ....... respeitamos, é o que pedimos no prompt;
 *   - terminando em Z ..................... reinterpretamos a hora como local;
 *   - sem fuso nenhum ..................... aplicamos o fuso do usuário;
 *   - só a data, sem hora ................. 09:00 local e temHora=false, para o
 *                                           assistente perguntar o horário.
 */
export function interpretarPrazo(valor: unknown, tz = 'America/Sao_Paulo'): Prazo {
  const bruto = String(valor ?? '').trim();
  const vazio: Prazo = { iso: null, temHora: false, original: bruto };
  if (!bruto) return vazio;

  const soData = bruto.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (soData) {
    const base = new Date(`${soData[1]}T12:00:00Z`);
    const iso = `${soData[1]}T09:00:00${offsetDoFuso(base, tz)}`;
    return { iso: new Date(iso).toISOString(), temHora: false, original: bruto };
  }

  const m = bruto.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) {
    const solto = new Date(bruto);
    return isNaN(solto.getTime()) ? vazio : { iso: solto.toISOString(), temHora: true, original: bruto };
  }

  const [, data, hora, fuso] = m;
  const relogio = hora.length === 5 ? `${hora}:00` : hora;

  if (fuso && fuso !== 'Z') {
    const normal = fuso.length === 5 ? `${fuso.slice(0, 3)}:${fuso.slice(3)}` : fuso;
    return { iso: new Date(`${data}T${relogio}${normal}`).toISOString(), temHora: true, original: bruto };
  }

  // Sem fuso, ou com Z: a hora escrita é a hora que a pessoa falou. Local.
  const offset = offsetDoFuso(new Date(`${data}T12:00:00Z`), tz);
  return { iso: new Date(`${data}T${relogio}${offset}`).toISOString(), temHora: true, original: bruto };
}

/**
 * "Hoje" e os próximos dias JÁ NO FUSO DO USUÁRIO, para o prompt.
 *
 * A versão anterior mandava `new Date().toLocaleDateString('pt-BR')` sem fuso —
 * ou seja, a data do servidor, em UTC. Depois das 21h de Brasília o modelo era
 * informado do dia seguinte, e todo "amanhã", "terça", "semana que vem" saía
 * com um dia de erro. Era a causa de compromissos aparecerem na semana errada.
 */
export function calendarioDoPrompt(tz = 'America/Sao_Paulo', dias = 21): string {
  const agora = new Date();
  const fmt = (d: Date) =>
    `${d.toLocaleDateString('en-CA', { timeZone: tz })} (${d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: tz })})`;
  const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  const linhas: string[] = [];
  for (let i = 1; i <= dias; i++) {
    const d = new Date(agora.getTime() + i * 864e5);
    linhas.push(`  ${i === 1 ? 'amanhã' : `+${i}d`}: ${fmt(d)}`);
  }
  return [
    `AGORA: ${fmt(agora)}, ${hora} — fuso ${tz} (offset ${offsetDoFuso(agora, tz)}).`,
    'PRÓXIMOS DIAS (use esta tabela, não calcule de cabeça):',
    ...linhas,
  ].join('\n');
}
