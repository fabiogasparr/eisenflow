/**
 * whatsapp-webhook / conversa com IA
 * ──────────────────────────────────────────────────────────────────────
 * Function calling sobre as tarefas do usuário. As 13 tools são as mesmas da
 * versão Lovable — o que mudou é o transporte: o gateway da Lovable virou
 * chat() de _shared/ai.ts (OmniRoute), e o envio de WhatsApp virou
 * evolution.sendText(token, ...).
 */
import { admin } from '../_shared/supabase.ts';
import { chat, imagePart, type Tool } from '../_shared/ai.ts';
import { evolution } from '../_shared/evolution.ts';
import {
  type Row,
  atualizarTarefa, tarefasDoUsuario, membrosDoTime, perfilDe, historico, salvarMensagem,
  podarHistorico, formatarQuando, listarTarefas, ROTULO_QUADRANTE, ROTULO_STATUS,
} from './dados.ts';

const idx = (n: unknown) => (Number(n) || 0) - 1;

export const TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'create_task', description: 'Criar uma nova tarefa para o usuário',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título da tarefa' },
          description: { type: 'string', description: 'Descrição opcional' },
          quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'], description: 'do=urgente+importante, schedule=importante, delegate=urgente, eliminate=nem urgente nem importante' },
          urgency: { type: 'number', description: '1-5' },
          importance: { type: 'number', description: '1-5' },
          due_date: { type: 'string', description: 'Prazo em ISO 8601, ex: 2026-03-20T00:00:00Z' },
        },
        required: ['title'], additionalProperties: false,
      },
    },
  },
  { type: 'function', function: { name: 'list_tasks', description: 'Listar as tarefas pendentes/em andamento do usuário', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'complete_task', description: 'Marcar uma tarefa como concluída pelo índice na lista', parameters: { type: 'object', properties: { task_index: { type: 'number', description: 'Índice 1-based' } }, required: ['task_index'], additionalProperties: false } } },
  { type: 'function', function: { name: 'start_task', description: 'Marcar uma tarefa como em andamento pelo índice', parameters: { type: 'object', properties: { task_index: { type: 'number' } }, required: ['task_index'], additionalProperties: false } } },
  { type: 'function', function: { name: 'urgent_task', description: "Mover uma tarefa para o quadrante 'Fazer Agora' (urgente + importante)", parameters: { type: 'object', properties: { task_index: { type: 'number' } }, required: ['task_index'], additionalProperties: false } } },
  { type: 'function', function: { name: 'delete_task', description: 'Excluir/eliminar uma tarefa pelo índice', parameters: { type: 'object', properties: { task_index: { type: 'number' } }, required: ['task_index'], additionalProperties: false } } },
  {
    type: 'function',
    function: {
      name: 'update_task', description: 'Atualizar campos de uma tarefa existente',
      parameters: {
        type: 'object',
        properties: {
          task_index: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' },
          quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
          urgency: { type: 'number' }, importance: { type: 'number' }, due_date: { type: 'string' },
        },
        required: ['task_index'], additionalProperties: false,
      },
    },
  },
  { type: 'function', function: { name: 'delegate_task', description: 'Delegar uma tarefa para um membro do time', parameters: { type: 'object', properties: { task_index: { type: 'number' }, member_name: { type: 'string', description: 'Nome (ou parte) do membro' } }, required: ['task_index', 'member_name'], additionalProperties: false } } },
  { type: 'function', function: { name: 'schedule_task', description: 'Agendar uma tarefa com prazo específico', parameters: { type: 'object', properties: { task_index: { type: 'number' }, due_date: { type: 'string', description: 'ISO 8601' } }, required: ['task_index', 'due_date'], additionalProperties: false } } },
  {
    type: 'function',
    function: {
      name: 'add_task_reminder',
      description: "Programar um lembrete para uma tarefa. Use quando o usuário pedir 'me lembre', 'me avise', 'manda um alerta'.",
      parameters: {
        type: 'object',
        properties: {
          task_index: { type: 'number' },
          when: { type: 'string', enum: ['1d_before', '1h_before', 'at_due', 'at_start', 'custom'], description: '1d_before=1 dia antes do prazo; 1h_before=1h antes; at_due=no prazo; at_start=no início agendado; custom=data/hora em custom_datetime.' },
          custom_datetime: { type: 'string', description: 'Obrigatório se when=custom. ISO 8601 com fuso, ex: 2026-06-05T14:00:00-03:00.' },
          channels: { type: 'array', items: { type: 'string', enum: ['in_app', 'browser', 'whatsapp_personal', 'whatsapp_tenant', 'email'] }, description: 'Padrão: WhatsApp pessoal + no app.' },
        },
        required: ['task_index', 'when'], additionalProperties: false,
      },
    },
  },
  { type: 'function', function: { name: 'list_task_reminders', description: 'Listar os lembretes ativos de uma tarefa', parameters: { type: 'object', properties: { task_index: { type: 'number' } }, required: ['task_index'], additionalProperties: false } } },
  { type: 'function', function: { name: 'remove_task_reminder', description: 'Cancelar um lembrete específico de uma tarefa', parameters: { type: 'object', properties: { task_index: { type: 'number' }, reminder_index: { type: 'number', description: 'Índice 1-based da lista de list_task_reminders' } }, required: ['task_index', 'reminder_index'], additionalProperties: false } } },
  { type: 'function', function: { name: 'chat_response', description: 'Responder ao usuário quando nenhuma ação de tarefa é necessária', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } } },
];

// ────────────────────────────────────────────── respostas rápidas (1/2/3)
/**
 * O lembrete recém-criado fica "pendente de confirmação" gravado como mensagem
 * de sistema no próprio histórico — não há tabela para isso no schema, e o
 * original fazia igual. TTL de 15 min, consumo marcado por um segundo registro.
 */
async function acaoPendente(userId: string): Promise<{ reminder_id: string; task_title: string } | null> {
  const db = admin();
  const { data: linhas } = await db
    .from('whatsapp_chat_history')
    .select('content')
    .eq('user_id', userId)
    .eq('role', 'system')
    .order('created_at', { ascending: false })
    .limit(20);
  for (const linha of linhas ?? []) {
    const c: string = linha.content || '';
    if (c.startsWith('__pending_reminder_consumed__:')) continue;
    if (!c.startsWith('__pending_reminder__:')) continue;
    try {
      const dados = JSON.parse(c.slice('__pending_reminder__:'.length));
      if (!dados?.reminder_id) return null;
      if (dados.expires_at && Date.now() > Number(dados.expires_at)) return null;
      const { data: consumido } = await db
        .from('whatsapp_chat_history')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'system')
        .eq('content', `__pending_reminder_consumed__:${dados.reminder_id}`)
        .limit(1)
        .maybeSingle();
      if (consumido) return null;
      return { reminder_id: dados.reminder_id, task_title: dados.task_title || 'tarefa' };
    } catch { return null; }
  }
  return null;
}

async function respostaRapida(userId: string, texto: string, tz: string): Promise<string | null> {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return null;
  const confirmar = ['1', 'sim', 's', 'confirmar', 'ok', 'confirma'].includes(t);
  const reagendar = ['2', 'reagendar', 'adiar', '+1h'].includes(t);
  const cancelar = ['3', 'cancelar', 'cancela', 'nao', 'não', 'n'].includes(t);
  if (!confirmar && !reagendar && !cancelar) return null;

  const pendente = await acaoPendente(userId);
  if (!pendente) return null;
  const db = admin();
  const consumir = () => salvarMensagem(userId, 'system', `__pending_reminder_consumed__:${pendente.reminder_id}`);

  if (confirmar) {
    await consumir();
    return `✅ Lembrete confirmado para *${pendente.task_title}*.`;
  }
  if (cancelar) {
    await db.from('task_reminders').update({ enabled: false }).eq('id', pendente.reminder_id);
    await consumir();
    return `🚫 Lembrete cancelado para *${pendente.task_title}*.`;
  }

  const { data: rem } = await db.from('task_reminders').select('scheduled_at').eq('id', pendente.reminder_id).maybeSingle();
  if (!rem?.scheduled_at) {
    await consumir();
    return '⚠️ Não consegui localizar o lembrete para reagendar.';
  }
  const novo = new Date(new Date(rem.scheduled_at).getTime() + 3600e3);
  await db.from('task_reminders').update({ scheduled_at: novo.toISOString(), enabled: true }).eq('id', pendente.reminder_id);
  await consumir();
  await salvarMensagem(userId, 'system', `__pending_reminder__:${JSON.stringify({
    reminder_id: pendente.reminder_id, task_title: pendente.task_title, expires_at: Date.now() + 15 * 60e3,
  })}`);
  return [
    `📆 Lembrete reagendado para *${pendente.task_title}*`,
    `🗓️ Novo horário: ${formatarQuando(novo, tz)}`,
    '', 'Responda:', '1️⃣ Confirmar', '2️⃣ Reagendar +1h', '3️⃣ Cancelar',
  ].join('\n');
}

// ─────────────────────────────────────────────────────── execução das tools
export interface ContextoTool {
  userId: string;
  tarefas: Row[];
  membros: Row[];
  tz: string;
}

export async function executarTool(nome: string, args: Row, ctx: ContextoTool): Promise<string> {
  const { userId, tarefas, membros, tz } = ctx;
  const tarefa = () => tarefas[idx(args.task_index)];
  const db = admin();

  switch (nome) {
    case 'create_task': {
      const dados: Row = {
        title: args.title, created_by: userId,
        quadrant: args.quadrant || 'do', status: 'pending',
      };
      if (args.description) dados.description = args.description;
      if (args.urgency) dados.urgency = args.urgency;
      if (args.importance) dados.importance = args.importance;
      if (args.due_date) dados.due_date = args.due_date;
      const { error } = await db.from('tasks').insert(dados);
      if (error) throw error;
      return `✅ Tarefa criada: *${args.title}*`;
    }

    case 'list_tasks':
      return tarefas.length ? `📋 *Suas tarefas:*\n\n${listarTarefas(tarefas)}` : '📋 Nenhuma tarefa pendente!';

    case 'complete_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      await atualizarTarefa(t.id, { status: 'completed', completed_at: new Date().toISOString() });
      return `✅ Tarefa concluída: *${t.title}*`;
    }

    case 'start_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      await atualizarTarefa(t.id, { status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' });
      return `🔄 Em andamento: *${t.title}*`;
    }

    case 'urgent_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      await atualizarTarefa(t.id, { quadrant: 'do', urgency: 5, importance: 5 });
      return `🔴 Movida para "Fazer Agora": *${t.title}*`;
    }

    case 'delete_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      // O original marca 'eliminated' em vez de apagar — a tarefa some da lista sem perder histórico.
      await atualizarTarefa(t.id, { status: 'eliminated' });
      return `🗑️ Tarefa eliminada: *${t.title}*`;
    }

    case 'update_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      const mudanca: Row = {};
      for (const campo of ['title', 'description', 'quadrant', 'urgency', 'importance', 'due_date']) {
        if (args[campo]) mudanca[campo] = args[campo];
      }
      if (!Object.keys(mudanca).length) return '⚠️ Nenhum campo para atualizar.';
      await atualizarTarefa(t.id, mudanca);
      return `✏️ Tarefa atualizada: *${t.title}*`;
    }

    case 'delegate_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      const busca = String(args.member_name || '').toLowerCase();
      const achado = membros.find((p) => (p.display_name || '').toLowerCase().includes(busca));
      if (!achado) {
        const nomes = membros.map((p) => p.display_name).join(', ');
        return `❌ Membro "${args.member_name}" não encontrado.\n\n👥 *Membros disponíveis:* ${nomes || 'nenhum'}`;
      }
      return delegar(t, achado, userId);
    }

    case 'schedule_task': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      await atualizarTarefa(t.id, { due_date: args.due_date, quadrant: 'schedule' });
      return `📅 Tarefa agendada para ${new Date(args.due_date).toLocaleDateString('pt-BR')}: *${t.title}*`;
    }

    case 'add_task_reminder': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      const canais: string[] = Array.isArray(args.channels) && args.channels.length ? args.channels : ['whatsapp_personal', 'in_app'];
      const quando = String(args.when || '');
      let em: Date | null = null; let rotulo = '';

      if (quando === 'custom') {
        if (!args.custom_datetime) return '⚠️ Informe a data/hora do lembrete (custom_datetime).';
        em = new Date(args.custom_datetime); rotulo = 'na data escolhida';
      } else if (quando === 'at_start') {
        if (!t.started_at) return '⚠️ A tarefa não tem início agendado. Defina o início antes de usar at_start.';
        em = new Date(t.started_at); rotulo = 'no início';
      } else {
        if (!t.due_date) return '⚠️ A tarefa não tem prazo. Defina o prazo primeiro (use schedule_task).';
        const prazo = new Date(t.due_date).getTime();
        if (quando === '1d_before') { em = new Date(prazo - 864e5); rotulo = '1 dia antes do prazo'; }
        else if (quando === '1h_before') { em = new Date(prazo - 3600e3); rotulo = '1 hora antes do prazo'; }
        else if (quando === 'at_due') { em = new Date(prazo); rotulo = 'no prazo'; }
        else return '⚠️ Valor de "when" inválido.';
      }
      if (!em || isNaN(em.getTime())) return '⚠️ Data/hora inválida.';
      if (em.getTime() < Date.now() - 60_000) return '⚠️ Esse horário já passou.';

      // O trigger trg_task_reminders_expand do Postgres expande esta linha em
      // scheduled_reminders — aqui só se cria o lembrete "pai".
      const { data: criado, error } = await db.from('task_reminders').insert({
        task_id: t.id, created_by: userId, kind: 'custom',
        scheduled_at: em.toISOString(), recipients: ['creator'], channels: canais,
        enabled: true, auto_generated: false,
      }).select('id').single();
      if (error || !criado) {
        console.log(`add_task_reminder falhou: ${error?.message}`);
        return '❌ Não consegui criar o lembrete agora. Tente novamente em alguns segundos.';
      }

      const nomesCanais: Record<string, string> = {
        whatsapp_personal: 'WhatsApp', whatsapp_tenant: 'WhatsApp da empresa',
        in_app: 'App', browser: 'Navegador', email: 'Email',
      };
      const canaisBonitos = canais.map((c) => nomesCanais[c] || c).join(' + ');

      await salvarMensagem(userId, 'system', `__pending_reminder__:${JSON.stringify({
        reminder_id: criado.id, task_title: t.title, expires_at: Date.now() + 15 * 60e3,
      })}`);

      return [
        '⏰ *Lembrete criado*', '',
        `📌 Tarefa: *${t.title}*`,
        `🗓️ Quando: ${formatarQuando(em, tz)} (${rotulo})`,
        `📢 Canais: ${canaisBonitos}`,
        '', 'Responda:', '1️⃣ Confirmar', '2️⃣ Reagendar +1h', '3️⃣ Cancelar',
      ].join('\n');
    }

    case 'list_task_reminders': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      const rems = await lembretesAtivos(t.id);
      if (!rems.length) return `📭 Nenhum lembrete ativo para *${t.title}*.`;
      const linhas = rems.map((r, i) => {
        const dt = r.scheduled_at
          ? new Date(r.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz })
          : '—';
        return `${i + 1}. ${dt} (${(r.channels || []).join(', ')})`;
      });
      return `⏰ *Lembretes de "${t.title}":*\n${linhas.join('\n')}`;
    }

    case 'remove_task_reminder': {
      const t = tarefa(); if (!t) return '❌ Tarefa não encontrada';
      const rems = await lembretesAtivos(t.id);
      const alvo = rems[idx(args.reminder_index)];
      if (!alvo) return '❌ Lembrete não encontrado.';
      await db.from('task_reminders').update({ enabled: false }).eq('id', alvo.id);
      return `🚫 Lembrete cancelado para *${t.title}*.`;
    }

    case 'chat_response':
      return args.message || '🤔 Não entendi. Pode reformular?';

    default:
      return '❓ Ação não reconhecida.';
  }
}

async function lembretesAtivos(taskId: string): Promise<Row[]> {
  const { data } = await admin()
    .from('task_reminders')
    .select('*')
    .eq('task_id', taskId)
    .eq('enabled', true)
    .order('scheduled_at', { ascending: true })
    .limit(25);
  return data ?? [];
}

/**
 * Delegação: muda o responsável (assigned_to), registra em `delegations` e
 * avisa o delegado pela instância DELE (cada instância tem token próprio).
 * Com RLS no Postgres, o novo responsável passa a enxergar a tarefa pela
 * própria policy — não há permissão por documento a regravar.
 */
export async function delegar(tarefa: Row, destino: Row, userId: string): Promise<string> {
  const db = admin();
  await atualizarTarefa(tarefa.id, { assigned_to: destino.user_id, quadrant: 'delegate' });

  const { error } = await db.from('delegations').insert({
    task_id: tarefa.id, delegated_by: userId, delegated_to: destino.user_id, status: 'pending',
  });
  if (error) console.log(`delegations: ${error.message}`);

  try {
    const { data: conn } = await db
      .from('whatsapp_connections')
      .select('phone_number, instance_token')
      .eq('user_id', destino.user_id)
      .eq('status', 'connected')
      .maybeSingle();
    if (conn?.phone_number && conn?.instance_token) {
      const quem = (await perfilDe(userId))?.display_name || 'Alguém';
      await evolution.sendText(conn.instance_token, conn.phone_number,
        `📥 *Nova tarefa delegada para você!*\n\n📝 *${tarefa.title}*\n👤 Delegada por: ${quem}\n\nUse /listar para ver suas tarefas.`);
    }
  } catch (e) { console.log(`aviso ao delegado falhou: ${(e as Error).message}`); }

  return `🟦 Tarefa delegada para *${destino.display_name}*: *${tarefa.title}*`;
}

// ──────────────────────────────────────────────────────────── conversa
function promptSistema(tarefas: Row[], membros: Row[]): string {
  const contextoTarefas = tarefas.length
    ? tarefas.map((t, i) => {
        const p = [`${i + 1}. "${t.title}" [${ROTULO_STATUS[t.status] || t.status}] [${ROTULO_QUADRANTE[t.quadrant] || t.quadrant}]`];
        if (t.due_date) p.push(`Prazo: ${new Date(t.due_date).toLocaleString('pt-BR')}`);
        if (t.started_at) p.push(`Início: ${new Date(t.started_at).toLocaleString('pt-BR')}`);
        return p.join(' ');
      }).join('\n')
    : 'Nenhuma tarefa pendente.';

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Você é um assistente de produtividade via WhatsApp. Hoje é ${hoje}.
O usuário gerencia tarefas usando a Matriz de Eisenhower (quadrantes: do, schedule, delegate, eliminate).

TAREFAS ATUAIS DO USUÁRIO:
${contextoTarefas}

MEMBROS DO TIME (para delegação):
${membros.length ? membros.map((m) => m.display_name).join(', ') : 'Nenhum membro de time disponível.'}

REGRAS:
- Use as tools disponíveis para executar ações (criar, concluir, editar, delegar, agendar, listar tarefas).
- Se o usuário pedir algo que não envolve tarefas, responda usando chat_response.
- task_index é 1-based (1 = primeira tarefa da lista).
- Quando o usuário mencionar uma tarefa por nome, encontre o índice correto na lista acima.
- Para criar tarefas, escolha o quadrante adequado com base no contexto.
- Seja conciso e amigável nas respostas. Use emojis de forma moderada.
- Responda sempre em português brasileiro.
- Se a mensagem for ambígua, peça esclarecimento via chat_response.
- Quando o usuário enviar imagens (prints, fotos, recibos, anotações), faça OCR + análise visual e crie automaticamente as tarefas relevantes via create_task. Se houver várias tarefas na imagem, chame create_task várias vezes. Resuma ao final usando chat_response.

LEMBRETES (você TEM essa capacidade):
- Você pode criar, listar e cancelar lembretes para tarefas com as tools add_task_reminder, list_task_reminders e remove_task_reminder.
- Quando o usuário disser "me lembre", "me avise", "manda um alerta", "lembrete", use add_task_reminder. NUNCA diga que não tem essa funcionalidade.
- Mapeie a intenção para "when": "1 hora antes" → 1h_before; "amanhã"/"1 dia antes" → 1d_before; "no horário"/"na hora" → at_due; "quando começar"/"no início" → at_start; data/hora específica → custom (custom_datetime em ISO 8601 com fuso, ex: 2026-06-05T14:00:00-03:00).
- Por padrão envie pelo canal whatsapp_personal e in_app (não precisa perguntar).
- Se a tarefa não tem prazo e o pedido é relativo (ex: "1h antes"), peça o prazo via chat_response ou use schedule_task primeiro.`;
}

export interface EntradaIA {
  texto: string;
  userId: string;
  imagens?: string[];
  tz?: string;
}

/**
 * @param texto    texto da mensagem (ou a transcrição do áudio)
 * @param imagens  data URLs; presença delas troca o modelo para visão
 * @param tz       fuso do usuário, para datas nas respostas
 */
export async function processarComIA({ texto, userId, imagens = [], tz = 'America/Sao_Paulo' }: EntradaIA): Promise<string> {
  // Antes de gastar IA: "1", "2", "3" respondendo ao card de lembrete.
  if (!imagens.length) {
    const rapida = await respostaRapida(userId, texto, tz);
    if (rapida) {
      await salvarMensagem(userId, 'user', texto);
      await salvarMensagem(userId, 'assistant', rapida);
      return rapida;
    }
  }

  const [tarefas, membros, conversa] = await Promise.all([
    tarefasDoUsuario(userId, 20), membrosDoTime(userId), historico(userId),
  ]);

  const textoHistorico = imagens.length
    ? `${texto || ''}${texto ? ' ' : ''}[📷 ${imagens.length} imagem(ns) enviada(s)]`
    : texto;
  await salvarMensagem(userId, 'user', textoHistorico);

  const conteudoUsuario = imagens.length
    ? [{ type: 'text', text: texto?.trim() || 'Analise a(s) imagem(ns) e crie tarefas relevantes para mim.' },
       ...imagens.map((url) => imagePart(url))]
    : texto;

  let resultado;
  try {
    resultado = await chat({
      // Com imagem o gargalo é a leitura; sem imagem, a qualidade da conversa.
      proposito: imagens.length ? 'visao' : 'conversar',
      temperature: 0.3,
      tools: TOOLS,
      messages: [
        { role: 'system', content: promptSistema(tarefas, membros) },
        // Os marcadores __pending_reminder__ são estado interno, não contexto de conversa.
        ...conversa
          .filter((m) => !(m.role === 'system' && String(m.content).startsWith('__pending_reminder')))
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: conteudoUsuario },
      ],
    });
  } catch (e) {
    console.log(`IA falhou: ${(e as Error).message}`);
    return '⚠️ Erro ao processar sua mensagem. Use /ajuda para ver comandos disponíveis.';
  }

  const ctx: ContextoTool = { userId, tarefas, membros, tz };
  let resposta = '';

  if (resultado.toolCalls?.length) {
    const saidas: string[] = [];
    for (const tc of resultado.toolCalls) saidas.push(await executarTool(tc.name, tc.arguments || {}, ctx));
    resposta = saidas.join('\n\n');
  } else if (resultado.content) {
    resposta = resultado.content;
  }

  if (!resposta) return '🤔 Não entendi. Pode reformular?';
  await salvarMensagem(userId, 'assistant', resposta);
  podarHistorico(userId).catch(() => {});
  return resposta;
}
