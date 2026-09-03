/**
 * whatsapp-webhook / acesso a dados
 * ──────────────────────────────────────────────────────────────────────
 * Tudo que o webhook lê e grava no banco, num lugar só, para os comandos
 * slash e o caminho de IA compartilharem as MESMAS consultas — no original
 * as duas rotas repetiam a query de tarefas com limites diferentes (20 na IA,
 * 15 nos comandos), e o índice mostrado ao usuário mudava conforme o caminho.
 * Aqui o limite é parâmetro e os dois caminhos usam a mesma ordenação.
 */
import { db, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';

/** Status que contam como "tarefa viva" — é a lista do original. */
export const STATUS_ABERTOS = ['pending', 'in_progress'];

/**
 * db.create()/db.update() carimbam updated_at; whatsapp_chat_history,
 * whatsapp_processed_messages e whatsapp_sent_reminders NÃO têm esse atributo
 * (ver appwrite/schema.mjs) e o Appwrite recusaria a escrita. Estas vão cruas.
 */
export const criarCru = (collection, data, permissions) =>
  rawCall('POST', `/databases/${DATABASE_ID}/collections/${collection}/documents`, {
    documentId: 'unique()', data, ...(permissions ? { permissions } : {}),
  });

/** 409 = violação de índice único. É o sinal de "outro alguém chegou antes". */
export const ehConflito = (e) => e?.status === 409;

/**
 * Permissões de documento de uma tarefa — espelha taskPermissions() de
 * src/integrations/appwrite/permissions.ts. Sempre que a titularidade muda
 * (delegar), as permissões precisam ser regravadas junto.
 */
export function permissoesDaTarefa({ createdBy, assignedTo }) {
  const p = [`read("user:${createdBy}")`, `update("user:${createdBy}")`, `delete("user:${createdBy}")`];
  if (assignedTo && assignedTo !== createdBy) p.push(`read("user:${assignedTo}")`, `update("user:${assignedTo}")`);
  return [...new Set(p)];
}

/** Lembrete herda a permissão do dono da tarefa (documento filho). */
export const permissoesDoLembrete = (userId) => [
  `read("user:${userId}")`, `update("user:${userId}")`, `delete("user:${userId}")`,
];

// ------------------------------------------------------------------ tarefas
export async function tarefasDoUsuario(userId, limite = 20) {
  const r = await db.list('tasks', [
    Query.equal('created_by', userId),
    Query.equal('status', STATUS_ABERTOS),
    Query.orderDesc('created_at'),
    Query.limit(limite),
  ]);
  return r.documents || [];
}

// -------------------------------------------------------------------- times
/** Colegas de time do usuário, já com display_name resolvido (sem join). */
export async function membrosDoTime(userId) {
  const meus = await db.list('team_members', [Query.equal('user_id', userId), Query.limit(100)]);
  const teamIds = (meus.documents || []).map((t) => t.team_id);
  if (!teamIds.length) return [];

  const outros = await db.list('team_members', [
    Query.equal('team_id', teamIds), Query.notEqual('user_id', userId), Query.limit(200),
  ]);
  const ids = [...new Set((outros.documents || []).map((m) => m.user_id))];
  if (!ids.length) return [];

  const perfis = await db.list('profiles', [Query.equal('user_id', ids), Query.limit(200)]);
  return (perfis.documents || []).filter((p) => p.display_name);
}

export async function perfilDe(userId) {
  return db.findOne('profiles', [Query.equal('user_id', userId)]);
}

// ---------------------------------------------------------------- histórico
export async function historico(userId, limite = 10) {
  const r = await db.list('whatsapp_chat_history', [
    Query.equal('user_id', userId), Query.orderDesc('created_at'), Query.limit(limite),
  ]);
  return (r.documents || []).reverse();
}

export const salvarMensagem = (userId, role, content) =>
  criarCru('whatsapp_chat_history', {
    user_id: userId, role, content, created_at: new Date().toISOString(),
  }, [`read("user:${userId}")`]);

/** Mantém as últimas N mensagens do usuário; o resto vira lixo de contexto. */
export async function podarHistorico(userId, manter = 30) {
  const r = await db.list('whatsapp_chat_history', [
    Query.equal('user_id', userId), Query.orderDesc('created_at'),
    Query.offset(manter), Query.limit(100),
  ]);
  for (const doc of r.documents || []) {
    await db.delete('whatsapp_chat_history', doc.$id).catch(() => {});
  }
}

// -------------------------------------------------------------- formatação
export const EMOJI_QUADRANTE = { do: '🔴', schedule: '🔵', delegate: '🟡', eliminate: '⚪' };
export const EMOJI_STATUS = { pending: '⏳', in_progress: '🔄' };
export const ROTULO_QUADRANTE = { do: 'Fazer Agora', schedule: 'Agendar', delegate: 'Delegar', eliminate: 'Eliminar' };
export const ROTULO_STATUS = { pending: 'Pendente', in_progress: 'Em andamento' };

export const listarTarefas = (tarefas) =>
  tarefas.map((t, i) =>
    `${i + 1}. ${EMOJI_STATUS[t.status] || ''} ${EMOJI_QUADRANTE[t.quadrant] || ''} ${t.title}` +
    (t.due_date ? ` (📅 ${new Date(t.due_date).toLocaleDateString('pt-BR')})` : '')
  ).join('\n');

/** "amanhã (05/06) às 14:00" — sempre no fuso do usuário, não no do servidor. */
export function formatarQuando(d, tz = 'America/Sao_Paulo') {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
  const dia = (x) => x.toLocaleDateString('en-CA', { timeZone: tz });
  const agora = new Date();
  const alvo = dia(d);
  let rel;
  if (alvo === dia(agora)) rel = 'hoje';
  else if (alvo === dia(new Date(agora.getTime() + 864e5))) rel = 'amanhã';
  else rel = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: tz });
  return `${rel} (${data}) às ${hora}`;
}
