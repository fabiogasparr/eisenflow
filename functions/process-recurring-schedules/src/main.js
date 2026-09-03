/**
 * process-recurring-schedules
 * ──────────────────────────────────────────────────────────────────────
 * Produtora da fila de lembretes. Faz duas coisas a cada tique:
 *
 *   FASE 1 — sincroniza os lembretes automáticos das tarefas e os expande em
 *            `scheduled_reminders`. É o porte das funções SQL
 *            `compute_reminder_scheduled_at`, `sync_task_auto_reminders` e
 *            `expand_task_reminder` (migrations 20260604153629 e 20260604174745)
 *            junto com os triggers `trg_tasks_reminders_sync`,
 *            `trg_task_reminders_expand` e `trg_task_shares_reexpand`.
 *
 *   FASE 2 — enfileira resumo diário e plano semanal quando bate o horário
 *            local do usuário. É o porte 1:1 do index.ts original.
 *
 * Quem consome a fila é `dispatch-reminders` (mesmo cron de 5 min).
 *
 * Origem: supabase/functions/process-recurring-schedules/index.ts (Deno)
 *         + supabase/migrations/20260604153629_*.sql
 *         + supabase/migrations/20260604174745_*.sql (versão final das funções)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA
 *
 * Gatilho .......... cron  (*\/5 * * * *)
 * Autenticação ..... agendamento, ou x-internal-secret numa chamada manual
 * Entrada .......... nenhuma
 * Saída ............ { ok, enqueued, sincronizadas, expandidos, cancelados }
 * Lê ............... tasks, task_reminders, task_shares,
 *                    user_reminder_preferences, recurring_schedules
 * Escreve .......... task_reminders, scheduled_reminders, recurring_schedules
 * Variáveis ........ INTERNAL_FUNCTION_SECRET, APPWRITE_API_KEY,
 *                    REMINDER_SYNC_HORIZON_DAYS (opcional, default 7)
 *
 * ─── DECISÕES DO PORTE ────────────────────────────────────────────────
 *
 * A. POR VARREDURA, NÃO POR TRIGGER. No Postgres a sincronização acontecia na
 *    escrita da tarefa. Aqui roda em lote, a cada 5 min, sobre uma JANELA:
 *    tarefas ativas cujo due_date (ou started_at) cai entre agora-10min e
 *    agora+REMINDER_SYNC_HORIZON_DAYS. A janela é o que mantém o lote dentro
 *    do timeout de 60s — e 7 dias já cobre com folga o lembrete mais antecipado
 *    (`due_d1`, um dia antes). Consequência visível: o lembrete automático de
 *    uma tarefa com prazo daqui a 3 meses só aparece na lista da tarefa quando
 *    ela entra na janela.
 *
 * B. A REGRA DOS 10 MINUTOS. `expand_task_reminder` CANCELAVA as linhas
 *    pendentes de um lembrete cujo scheduled_at já tivesse passado de 10 min.
 *    Lá isso era seguro: a função só rodava quando alguém editava o lembrete.
 *    Aqui ela rodaria a cada 5 min e apagaria a fila que o `dispatch-reminders`
 *    ainda não teve tempo de drenar. Mesma intenção, sem o estrago: não se
 *    CRIA linha para lembrete atrasado mais de 10 min, mas o que já está na
 *    fila não é cancelado por atraso.
 *
 * C. STATUS TERMINAL DA TAREFA. O ramo "IF t.status IN ('completed',
 *    'eliminated')" precisa reagir a uma mudança de status — sem trigger, o
 *    cancelamento da fila ficou em `dispatch-reminders`, na hora da entrega.
 *    Aqui só se garante que tarefa terminal nunca entra na varredura.
 *
 * D. ARRAYS SEM DEFAULT. `task_reminders.channels/recipients`,
 *    `recurring_schedules.channels` e `user_reminder_preferences.default_*`
 *    tinham DEFAULT no Postgres e não podem tê-lo no Appwrite. Os defaults
 *    originais estão aplicados no código (constantes abaixo).
 */
import { db, Query } from '../_shared/appwrite.js';
import { body, err, isScheduled } from '../_shared/http.js';

const ORCAMENTO_MS = 45_000;              // timeout declarado é 60s
const HORIZONTE_DIAS = Number(process.env.REMINDER_SYNC_HORIZON_DAYS) > 0
  ? Number(process.env.REMINDER_SYNC_HORIZON_DAYS) : 7;
const TOLERANCIA_ATRASO_MS = 10 * 60_000; // a "interval '10 minutes'" do SQL
const STATUS_ATIVOS = ['pending', 'in_progress'];
const TIPOS_AUTOMATICOS = ['due_d1', 'due_1h', 'due_now', 'start_now']; // auto_kinds do SQL

// Defaults que eram DEFAULT de coluna no Postgres (ver decisão D).
const CANAIS_PADRAO_LEMBRETE = ['in_app'];                  // task_reminders.channels
const CANAIS_PADRAO_PREFS = ['in_app', 'browser'];          // user_reminder_preferences.default_channels
const DESTINATARIOS_PADRAO = ['creator', 'assignee'];       // ..._recipients / task_reminders.recipients
const CANAIS_PADRAO_RECORRENCIA = ['in_app'];               // recurring_schedules.channels

/**
 * Porte de public.compute_reminder_scheduled_at(_kind, _due, _start).
 * Devolve ISO 8601 ou null — null significa "esse lembrete não se aplica".
 */
function calcularHorarioDoLembrete(kind, due, start) {
  const d = due ? new Date(due).getTime() : null;
  const s = start ? new Date(start).getTime() : null;
  switch (kind) {
    case 'due_d1': return d === null ? null : new Date(d - 86_400_000).toISOString();
    case 'due_1h': return d === null ? null : new Date(d - 3_600_000).toISOString();
    case 'due_now': return d === null ? null : new Date(d).toISOString();
    case 'start_now': return s === null ? null : new Date(s).toISOString();
    case 'start_5min': return s === null ? null : new Date(s - 300_000).toISOString();
    default: return null;
  }
}

const pedacos = (arr, n = 100) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Query.equal aceita no máximo 100 valores — busca em blocos e concatena. */
async function listarPorIds(colecao, campo, ids, extras = []) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out = [];
  for (const bloco of pedacos(unicos)) {
    out.push(...await db.listAll(colecao, [Query.equal(campo, bloco), ...extras]));
  }
  return out;
}

const comoArray = (v, padrao) => (Array.isArray(v) && v.length ? v : padrao);
const paraJson = (o) => JSON.stringify(o ?? {});
const lerJson = (s) => {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s) || {}; } catch { return {}; }
};

/** scheduled_reminders é 'server-doc': servidor escreve, destinatário lê. */
const permissoesFila = (userId) => [`read("user:${userId}")`];

// ══════════════════════════════════════════════════════ FASE 1 — lembretes
/**
 * Porte de sync_task_auto_reminders(): garante que cada tarefa ativa da janela
 * tenha (ou deixe de ter) os quatro lembretes automáticos, com o horário certo.
 */
async function sincronizarAutomaticos({ tarefas, lembretesPorTarefa, prefsPorUsuario, log, error }) {
  let criados = 0, atualizados = 0, removidos = 0;

  for (const t of tarefas) {
    const prefs = prefsPorUsuario.get(t.created_by) || null;
    const doTarefa = lembretesPorTarefa.get(t.$id) || [];

    for (const kind of TIPOS_AUTOMATICOS) {
      const horario = calcularHorarioDoLembrete(kind, t.due_date, t.started_at);

      // Toggle de preferência do CRIADOR da tarefa (era assim no SQL).
      let habilitado = true;
      if (prefs) {
        if (kind === 'due_d1') habilitado = prefs.auto_due_d1 !== false;
        else if (kind === 'due_1h') habilitado = prefs.auto_due_1h !== false;
        else if (kind === 'due_now') habilitado = prefs.auto_due_now !== false;
        else if (kind === 'start_now') habilitado = prefs.auto_start !== false;
      }

      const existente = doTarefa.find((r) => r.kind === kind && r.auto_generated);

      if (!habilitado || !horario) {
        // "DELETE FROM task_reminders WHERE task_id AND kind AND auto_generated"
        if (existente) {
          try {
            await db.delete('task_reminders', existente.$id);
            doTarefa.splice(doTarefa.indexOf(existente), 1);
            removidos++;
          } catch (e) { error(`sync: falha ao apagar lembrete ${existente.$id}: ${e.message}`); }
        }
        continue;
      }

      if (existente) {
        // Só escreve se algo mudou — a varredura roda a cada 5 min.
        if (existente.scheduled_at !== horario || existente.enabled === false) {
          try {
            const novo = await db.update('task_reminders', existente.$id, {
              scheduled_at: horario, enabled: true,
            });
            Object.assign(existente, novo);
            atualizados++;
          } catch (e) { error(`sync: falha ao atualizar lembrete ${existente.$id}: ${e.message}`); }
        }
        continue;
      }

      try {
        // PERMISSÕES: o lembrete herda as da tarefa pai (inheritFrom), como
        // faz o frontend em useTaskReminders — a policy antiga era um EXISTS
        // em tasks, que aqui vira permissão gravada no documento.
        const doc = await db.create('task_reminders', {
          task_id: t.$id,
          created_by: t.created_by,
          kind,
          scheduled_at: horario,
          recipients: comoArray(prefs?.default_recipients, DESTINATARIOS_PADRAO),
          channels: comoArray(prefs?.default_channels, CANAIS_PADRAO_PREFS),
          enabled: true,
          auto_generated: true,
        }, t.$permissions);
        doTarefa.push(doc);
        lembretesPorTarefa.set(t.$id, doTarefa);
        criados++;
      } catch (e) { error(`sync: falha ao criar lembrete ${kind} da tarefa ${t.$id}: ${e.message}`); }
    }
  }

  log(`sync automáticos: ${criados} criados, ${atualizados} atualizados, ${removidos} removidos`);
  return { criados, atualizados, removidos };
}

/**
 * Porte de expand_task_reminder(): materializa um lembrete em uma linha de
 * `scheduled_reminders` por (destinatário × canal), sem duplicar.
 *
 * A chave de unicidade do Postgres era o índice
 * idx_sched_unique_task(task_reminder_id, user_id, channel). O Appwrite não
 * tem índice único composto sobre esses três campos aqui, então a unicidade é
 * garantida no código: as linhas existentes são carregadas em lote e
 * indexadas por essa mesma chave antes de decidir INSERT ou UPDATE.
 */
async function expandirLembretes({ lembretes, tarefas, compartilhamentosPorTarefa, filaPorLembrete, agora, log, error }) {
  let inseridos = 0, atualizados = 0, cancelados = 0;
  const limite = agora.getTime() - TOLERANCIA_ATRASO_MS;

  for (const r of lembretes) {
    const t = tarefas.get(r.task_id);
    const existentes = filaPorLembrete.get(r.$id) || [];

    const cancelar = async (linha, motivo) => {
      try {
        await db.update('scheduled_reminders', linha.$id, { status: 'cancelled', last_error: motivo });
        cancelados++;
      } catch (e) { error(`expand: falha ao cancelar ${linha.$id}: ${e.message}`); }
    };

    // "IF NOT FOUND OR NOT r.enabled OR r.scheduled_at IS NULL" -> cancela pendentes
    if (!t || r.enabled === false || !r.scheduled_at) {
      for (const linha of existentes) {
        if (linha.status === 'pending') await cancelar(linha, !t ? 'tarefa_inexistente' : 'lembrete_desabilitado');
      }
      continue;
    }

    // Ver decisão B: atrasado demais não gera linha nova (e não cancela as que já existem).
    if (new Date(r.scheduled_at).getTime() < limite) continue;

    // Destinatários, na ordem do SQL: criador, responsável, compartilhados.
    const destinatarios = [];
    const alvos = comoArray(r.recipients, DESTINATARIOS_PADRAO);
    if (alvos.includes('creator') && t.created_by) destinatarios.push(t.created_by);
    if (alvos.includes('assignee') && t.assigned_to && !destinatarios.includes(t.assigned_to)) {
      destinatarios.push(t.assigned_to);
    }
    if (alvos.includes('shared')) {
      for (const s of compartilhamentosPorTarefa.get(t.$id) || []) {
        if (s.shared_with_user_id && !destinatarios.includes(s.shared_with_user_id)) {
          destinatarios.push(s.shared_with_user_id);
        }
      }
    }

    const canais = comoArray(r.channels, CANAIS_PADRAO_LEMBRETE);

    // "Cancel any pending rows that no longer fit"
    for (const linha of existentes) {
      if (linha.status !== 'pending') continue;
      if (linha.scheduled_at !== r.scheduled_at
        || !canais.includes(linha.channel)
        || !destinatarios.includes(linha.user_id)) {
        await cancelar(linha, 'nao_se_aplica_mais');
      }
    }

    if (destinatarios.length === 0) continue;

    const payload = paraJson({ task_title: t.title, due_date: t.due_date, started_at: t.started_at });
    const porChave = new Map(existentes.map((l) => [`${l.user_id}|${l.channel}`, l]));

    for (const userId of destinatarios) {
      for (const canal of canais) {
        const atual = porChave.get(`${userId}|${canal}`);
        try {
          if (atual) {
            // "status = CASE WHEN status IN ('sent','failed') THEN status ELSE 'pending' END"
            const status = ['sent', 'failed'].includes(atual.status) ? atual.status : 'pending';
            const igual = atual.scheduled_at === r.scheduled_at && atual.status === status && atual.payload === payload;
            if (igual) continue;
            await db.update('scheduled_reminders', atual.$id, {
              scheduled_at: r.scheduled_at, status, payload,
            });
            atualizados++;
          } else {
            const doc = await db.create('scheduled_reminders', {
              task_reminder_id: r.$id,
              task_id: t.$id,
              user_id: userId,
              tenant_id: t.tenant_id ?? null,
              kind: r.kind,
              channel: canal,
              scheduled_at: r.scheduled_at,
              status: 'pending',
              attempts: 0,
              payload,
            }, permissoesFila(userId));
            porChave.set(`${userId}|${canal}`, doc);
            inseridos++;
          }
        } catch (e) {
          error(`expand: falha em ${r.$id}/${userId}/${canal}: ${e.message}`);
        }
      }
    }
  }

  log(`expand: ${inseridos} enfileirados, ${atualizados} atualizados, ${cancelados} cancelados`);
  return { inseridos, atualizados, cancelados };
}

// ═════════════════════════════════════════════════ FASE 2 — recorrências
/** Porte de localTime(): hora/minuto/dia-da-semana/data no fuso do usuário. */
function horaLocal(tz, quando = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(quando).map((x) => [x.type, x.value]));
  const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hora: parseInt(p.hour || '0', 10),
    minuto: parseInt(p.minute || '0', 10),
    diaSemana: semana[p.weekday] ?? 0,
    ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Porte de buildSummary(): as próximas tarefas do usuário, em texto. */
async function montarResumo(userId) {
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const fim = new Date(); fim.setDate(fim.getDate() + 7);

  // O `.or(created_by.eq,assigned_to.eq)` do PostgREST vira Query.or.
  const tarefas = await db.list('tasks', [
    Query.or([Query.equal('created_by', userId), Query.equal('assigned_to', userId)]),
    Query.equal('status', STATUS_ATIVOS),
    Query.greaterThanEqual('due_date', inicio.toISOString()),
    Query.lessThanEqual('due_date', fim.toISOString()),
    Query.orderAsc('due_date'),
    Query.limit(15),
  ]);

  const docs = tarefas.documents || [];
  if (docs.length === 0) return 'Nenhuma tarefa pendente nos próximos dias. 🎉';
  return docs.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
}

async function processarRecorrencias({ agora, log, error }) {
  const agendamentos = await db.listAll('recurring_schedules', [Query.equal('enabled', true)]);
  let enfileirados = 0, disparados = 0;

  for (const s of agendamentos) {
    const tz = s.timezone || 'America/Sao_Paulo';
    const lt = horaLocal(tz, agora);
    const [hh, mm] = String(s.cron_local || '08:00').split(':').map(Number);
    const alvo = (hh || 0) * 60 + (mm || 0);
    const atual = lt.hora * 60 + lt.minuto;

    // Janela de 5 min — é a granularidade do cron.
    if (Math.abs(atual - alvo) > 4) continue;
    if (s.kind === 'weekly_plan' && s.weekday !== null && s.weekday !== undefined && s.weekday !== lt.diaSemana) continue;

    // IDEMPOTÊNCIA: last_run_at no mesmo dia local -> já rodou neste tique-dia.
    if (s.last_run_at && horaLocal(tz, new Date(s.last_run_at)).ymd === lt.ymd) continue;

    try {
      const corpo = await montarResumo(s.user_id);
      const titulo = s.kind === 'weekly_plan' ? 'Plano da semana' : 'Resumo do dia';

      for (const canal of comoArray(s.channels, CANAIS_PADRAO_RECORRENCIA)) {
        await db.create('scheduled_reminders', {
          recurring_schedule_id: s.$id,
          user_id: s.user_id,
          tenant_id: s.tenant_id ?? null,
          kind: s.kind,
          channel: canal,
          scheduled_at: agora.toISOString(),
          status: 'pending',
          attempts: 0,
          payload: paraJson({ task_title: titulo, body: corpo, ...lerJson(s.payload) }),
        }, permissoesFila(s.user_id));
        enfileirados++;
      }

      // Grava DEPOIS de enfileirar: se falhar no meio, o próximo tique refaz.
      await db.update('recurring_schedules', s.$id, { last_run_at: agora.toISOString() });
      disparados++;
    } catch (e) {
      error(`recorrência ${s.$id}: ${e.message}`);
    }
  }

  log(`recorrências: ${disparados} disparadas, ${enfileirados} itens na fila`);
  return { enfileirados, disparados };
}

// ═══════════════════════════════════════════════════════════ entrypoint
export default async ({ req, res, log, error }) => {
  const inicio = Date.now();
  try {
    if (!isScheduled(req)) {
      const segredo = process.env.INTERNAL_FUNCTION_SECRET;
      // Sem o segredo configurado, `undefined === undefined` liberaria geral.
      if (!segredo || req.headers['x-internal-secret'] !== segredo) {
        return res.json({ ok: false, error: 'somente execução agendada' }, 403);
      }
    }
    body(req); // corpo é ignorado; mantido para chamadas manuais não quebrarem

    const agora = new Date();
    const janelaInicio = new Date(agora.getTime() - TOLERANCIA_ATRASO_MS).toISOString();
    const janelaFim = new Date(agora.getTime() + HORIZONTE_DIAS * 86_400_000).toISOString();

    // ── FASE 1.a: tarefas ativas dentro da janela (por prazo ou por início) ──
    const porPrazo = await db.listAll('tasks', [
      Query.equal('status', STATUS_ATIVOS),
      Query.greaterThanEqual('due_date', janelaInicio),
      Query.lessThanEqual('due_date', janelaFim),
      Query.orderAsc('due_date'),
    ]);
    const porInicio = await db.listAll('tasks', [
      Query.equal('status', STATUS_ATIVOS),
      Query.greaterThanEqual('started_at', janelaInicio),
      Query.lessThanEqual('started_at', janelaFim),
      Query.orderAsc('started_at'),
    ]);
    const tarefasJanela = [...new Map([...porPrazo, ...porInicio].map((t) => [t.$id, t])).values()];

    const lembretesDasTarefas = await listarPorIds('task_reminders', 'task_id', tarefasJanela.map((t) => t.$id));
    const lembretesPorTarefa = new Map();
    for (const r of lembretesDasTarefas) {
      if (!lembretesPorTarefa.has(r.task_id)) lembretesPorTarefa.set(r.task_id, []);
      lembretesPorTarefa.get(r.task_id).push(r);
    }

    const prefs = await listarPorIds('user_reminder_preferences', 'user_id', tarefasJanela.map((t) => t.created_by));
    const prefsPorUsuario = new Map(prefs.map((p) => [p.user_id, p]));

    const sinc = await sincronizarAutomaticos({ tarefas: tarefasJanela, lembretesPorTarefa, prefsPorUsuario, log, error });

    // ── FASE 1.b: expansão ──
    // A varredura é dirigida por task_reminders (não por tasks) para pegar
    // também os lembretes 'custom' criados na mão pelo usuário, cujo horário
    // não tem relação com o prazo da tarefa.
    const lembretesJanela = await db.listAll('task_reminders', [
      Query.equal('enabled', true),
      Query.greaterThanEqual('scheduled_at', janelaInicio),
      Query.lessThanEqual('scheduled_at', janelaFim),
      Query.orderAsc('scheduled_at'),
    ]);

    // Pendentes na janela: pega também lembretes apagados/desabilitados que
    // deixaram linha órfã na fila (fazia o papel do trigger de DELETE).
    const pendentesJanela = (await db.listAll('scheduled_reminders', [
      Query.equal('status', 'pending'),
      Query.isNotNull('task_reminder_id'),
      Query.greaterThanEqual('scheduled_at', janelaInicio),
      Query.lessThanEqual('scheduled_at', janelaFim),
      Query.orderAsc('scheduled_at'),
    ])).filter((l) => l.task_reminder_id);

    const idsOrfaos = pendentesJanela
      .map((l) => l.task_reminder_id)
      .filter((id) => !lembretesJanela.some((r) => r.$id === id));
    const lembretesOrfaos = await listarPorIds('task_reminders', '$id', idsOrfaos);

    // Órfão de verdade (lembrete apagado): entra na lista com um esqueleto para
    // que expandirLembretes cancele as linhas pendentes dele.
    const conhecidos = new Set([...lembretesJanela, ...lembretesOrfaos].map((r) => r.$id));
    const fantasmas = [...new Set(idsOrfaos)]
      .filter((id) => !conhecidos.has(id))
      .map((id) => ({ $id: id, task_id: null, enabled: false, scheduled_at: null }));

    const lembretes = [...lembretesJanela, ...lembretesOrfaos, ...fantasmas];

    // Linhas já existentes desses lembretes, em qualquer status (é o que
    // distingue INSERT de UPDATE e o que preserva 'sent'/'failed').
    const filaExistente = await listarPorIds('scheduled_reminders', 'task_reminder_id', lembretes.map((r) => r.$id));
    const filaPorLembrete = new Map();
    for (const l of [...filaExistente, ...pendentesJanela]) {
      if (!filaPorLembrete.has(l.task_reminder_id)) filaPorLembrete.set(l.task_reminder_id, []);
      const lista = filaPorLembrete.get(l.task_reminder_id);
      if (!lista.some((x) => x.$id === l.$id)) lista.push(l);
    }

    const tarefasDosLembretes = await db.loadRelated('tasks', lembretes.map((r) => r.task_id));

    // task_shares só é necessário para lembretes que incluem 'shared'.
    const tarefasComShared = lembretes
      .filter((r) => comoArray(r.recipients, DESTINATARIOS_PADRAO).includes('shared'))
      .map((r) => r.task_id);
    const compartilhamentos = await listarPorIds('task_shares', 'task_id', tarefasComShared);
    const compartilhamentosPorTarefa = new Map();
    for (const s of compartilhamentos) {
      if (!compartilhamentosPorTarefa.has(s.task_id)) compartilhamentosPorTarefa.set(s.task_id, []);
      compartilhamentosPorTarefa.get(s.task_id).push(s);
    }

    const exp = await expandirLembretes({
      lembretes, tarefas: tarefasDosLembretes, compartilhamentosPorTarefa,
      filaPorLembrete, agora, log, error,
    });

    // ── FASE 2 ──
    let rec = { enfileirados: 0, disparados: 0 };
    if (Date.now() - inicio < ORCAMENTO_MS) {
      rec = await processarRecorrencias({ agora, log, error });
    } else {
      // As recorrências têm janela de 5 min; perder um tique não perde o dia,
      // porque a guarda de last_run_at é por DIA local, não por tique.
      log('process-recurring-schedules: sem orçamento para a fase de recorrências neste tique');
    }

    return res.json({
      ok: true,
      enqueued: rec.enfileirados,
      recorrencias: rec.disparados,
      sincronizadas: tarefasJanela.length,
      lembretes: sinc,
      fila: exp,
      janela: { de: janelaInicio, ate: janelaFim },
      ms: Date.now() - inicio,
    });
  } catch (e) {
    error(`process-recurring-schedules: ${e.message}`);
    return err(res, e);
  }
};
