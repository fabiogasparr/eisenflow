/**
 * google-calendar-sync
 * ──────────────────────────────────────────────────────────────────────
 * CRUD de eventos do Google Calendar e sincronização bidirecional com tasks,
 * por tenant.
 *
 * Origem: supabase/functions/google-calendar-sync/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... sessão/JWT do usuário + associação ao tenant
 * Entrada .......... { tenant_id, action:'list-calendars'|'list-events'|'create-event'|
 *                      'update-event'|'delete-event'|'import-events'|'sync-tasks', ... }
 * Saída ............ varia por action
 * Lê ............... google_calendar_tokens, tenant_members, tasks
 * Escreve .......... google_calendar_tokens (last_synced_at, refresh), tasks
 * APIs externas .... Google Calendar (REST via fetch)
 * Variáveis ........ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKENS_ENCRYPTION_KEY
 * Complexidade ..... alta
 *
 * O QUE MUDOU EM RELAÇÃO AO ORIGINAL
 *  1. MULTI-TENANT: a conexão é (user_id, tenant_id); as tarefas tocadas são as
 *     do usuário DENTRO do tenant. O original varria todas as tarefas do usuário.
 *  2. O original lia/gravava access_token em texto plano aqui e cifrado no auth.
 *     Agora os dois lados usam cripto.js (AES-256-GCM); o refresh está em
 *     _shared/google.js e é o mesmo para as duas functions.
 *  3. invalid_grant/401/403 do Google marcam is_revoked e devolvem
 *     code:'google_reconnect_required' para o front pedir a reconexão.
 *
 * PRESERVADO DO ORIGINAL (mapeamento tarefa <-> evento)
 *  - vínculo: tasks.google_event_id <-> event.id (1:1)
 *  - export : início = due_date, senão created_at; sem due_date vira evento de
 *             dia inteiro; duração fixa de 1h; título ganha ✅/❌ conforme status
 *  - import : cria tarefa com quadrant 'schedule', status 'pending',
 *             due_date = start.dateTime||start.date; se já existe tarefa com
 *             aquele google_event_id, atualiza só quando algo mudou
 *  - deleção: delete-event ignora 404 (evento já não existia no Google)
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser, getTenantRole } from '../_shared/auth.js';
import { body } from '../_shared/http.js';
import { buscarConexao, acessoValido, chamarGoogle } from '../_shared/google.js';

const FUSO = 'America/Sao_Paulo'; // igual ao original; o app é BR
const UMA_HORA = 60 * 60 * 1000;
const UM_DIA = 24 * UMA_HORA;

/** Bloco start/end do evento, no formato do Google. Porte direto do original. */
function inicioFim(startDateTime, endDateTime, allDay) {
  if (allDay) {
    const dia = new Date(startDateTime).toISOString().slice(0, 10);
    const seguinte = new Date(new Date(dia).getTime() + UM_DIA).toISOString().slice(0, 10);
    return { start: { date: dia }, end: { date: seguinte } };
  }
  return {
    start: { dateTime: startDateTime, timeZone: FUSO },
    end: {
      dateTime: endDateTime || new Date(new Date(startDateTime).getTime() + UMA_HORA).toISOString(),
      timeZone: FUSO,
    },
  };
}

const eventos = (calendarId) => `/calendars/${encodeURIComponent(calendarId)}/events`;

/** Permissões de tarefa criada pelo import — espelha taskPermissions() de permissions.ts. */
function permissoesDaTarefa(createdBy, tenantTeamId) {
  const p = [`read("user:${createdBy}")`, `update("user:${createdBy}")`, `delete("user:${createdBy}")`];
  if (tenantTeamId) p.push(`read("team:${tenantTeamId}")`);
  return p;
}

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const input = body(req);
    const { action, tenant_id: tenantId } = input;

    if (!tenantId) { const e = new Error('tenant_id é obrigatório'); e.status = 400; throw e; }
    if (!(await getTenantRole(db, tenantId, user.$id))) {
      const e = new Error('você não é membro deste tenant'); e.status = 403; throw e;
    }

    const doc = await buscarConexao(tenantId, user.$id);
    // Renova o token se faltar menos de 5 min — antes de qualquer chamada ao Google.
    const { accessToken, calendarId } = await acessoValido(doc, { log });

    const marcarSincronizado = () =>
      db.update('google_calendar_tokens', doc.$id, { last_synced_at: new Date().toISOString() }).catch(() => null);

    // ── LIST CALENDARS ──
    if (action === 'list-calendars') {
      const data = await chamarGoogle(accessToken, '/users/me/calendarList?maxResults=250', {}, doc);
      return res.json({
        calendars: (data.items || []).map((c) => ({
          id: c.id, summary: c.summary, primary: !!c.primary,
          backgroundColor: c.backgroundColor, accessRole: c.accessRole,
        })),
      });
    }

    // ── LIST EVENTS ──
    if (action === 'list-events') {
      const p = new URLSearchParams({
        timeMin: input.timeMin || new Date().toISOString(),
        timeMax: input.timeMax || new Date(Date.now() + 30 * UM_DIA).toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
      });
      const data = await chamarGoogle(accessToken, `${eventos(calendarId)}?${p}`, {}, doc);
      return res.json({ events: data.items || [] });
    }

    // ── CREATE EVENT ──
    if (action === 'create-event') {
      const { summary, description, startDateTime, endDateTime, allDay } = input;
      if (!summary || !startDateTime) { const e = new Error('summary e startDateTime são obrigatórios'); e.status = 400; throw e; }

      const evento = await chamarGoogle(accessToken, eventos(calendarId), {
        method: 'POST',
        body: JSON.stringify({ summary, description: description || '', ...inicioFim(startDateTime, endDateTime, allDay) }),
      }, doc);

      await marcarSincronizado();
      return res.json({ event: evento });
    }

    // ── UPDATE EVENT ──
    if (action === 'update-event') {
      const { eventId, summary, description, startDateTime, endDateTime, allDay } = input;
      if (!eventId) { const e = new Error('eventId é obrigatório'); e.status = 400; throw e; }

      const patch = {};
      if (summary) patch.summary = summary;
      if (description !== undefined) patch.description = description;
      if (startDateTime) Object.assign(patch, inicioFim(startDateTime, endDateTime, allDay));

      const evento = await chamarGoogle(accessToken, `${eventos(calendarId)}/${encodeURIComponent(eventId)}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      }, doc);
      return res.json({ event: evento });
    }

    // ── DELETE EVENT ──
    if (action === 'delete-event') {
      const { eventId } = input;
      if (!eventId) { const e = new Error('eventId é obrigatório'); e.status = 400; throw e; }
      try {
        await chamarGoogle(accessToken, `${eventos(calendarId)}/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, doc);
      } catch (e) {
        // 404/410 = o evento já não existe no Google. Do ponto de vista do app
        // o resultado desejado (não existir) foi alcançado. Igual ao original.
        if (e.googleStatus !== 404 && e.googleStatus !== 410) throw e;
      }
      return res.json({ success: true });
    }

    // ── IMPORT EVENTS (Google → tasks) ──
    if (action === 'import-events') {
      const p = new URLSearchParams({
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + 30 * UM_DIA).toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      });
      const data = await chamarGoogle(accessToken, `${eventos(calendarId)}?${p}`, {}, doc);
      const lista = data.items || [];

      // O tenant é um Team nativo: as tarefas importadas precisam do read do time.
      const tenant = await db.get('tenants', tenantId).catch(() => null);
      const permissoes = permissoesDaTarefa(user.$id, tenant?.appwrite_team_id);

      let imported = 0, updated = 0;
      for (const ev of lista) {
        if (!ev.id || !ev.summary) continue;
        const inicio = ev.start?.dateTime || ev.start?.date;
        if (!inicio) continue;

        // Sem join: uma consulta por evento, filtrada pelo índice idx_tasks_gcal.
        const existente = await db.findOne('tasks', [
          Query.equal('google_event_id', ev.id),
          Query.equal('created_by', user.$id),
          Query.equal('tenant_id', tenantId),
        ]);

        if (existente) {
          const precisaAtualizar =
            existente.title !== ev.summary ||
            (existente.description ?? null) !== (ev.description || null) ||
            existente.due_date !== inicio;
          if (precisaAtualizar) {
            await db.update('tasks', existente.$id, {
              title: ev.summary, description: ev.description || null, due_date: inicio,
            });
            updated++;
          }
        } else {
          await db.create('tasks', {
            title: ev.summary,
            description: ev.description || null,
            due_date: inicio,
            google_event_id: ev.id,
            created_by: user.$id,
            tenant_id: tenantId,
            quadrant: 'schedule',
            status: 'pending',
            tags: [], // arrays não têm default no Appwrite
          }, permissoes);
          imported++;
        }
      }

      await marcarSincronizado();
      log(`google-calendar-sync: import tenant ${tenantId} — ${imported} novos, ${updated} atualizados de ${lista.length}`);
      return res.json({ success: true, imported, updated, total: lista.length });
    }

    // ── SYNC TASKS (tasks → Google) ──
    if (action === 'sync-tasks') {
      const tarefas = await db.listAll('tasks', [
        Query.equal('created_by', user.$id),
        Query.equal('tenant_id', tenantId),
      ]);

      let synced = 0, falhas = 0;
      for (const t of tarefas) {
        const allDay = !t.due_date;
        const inicio = t.due_date || t.created_at || t.$createdAt;
        const prefixo = t.status === 'completed' ? '✅ ' : t.status === 'eliminated' ? '❌ ' : '';
        const corpo = {
          summary: prefixo + t.title,
          description: t.description || '',
          ...inicioFim(inicio, new Date(new Date(inicio).getTime() + UMA_HORA).toISOString(), allDay),
        };

        try {
          if (t.google_event_id) {
            await chamarGoogle(accessToken, `${eventos(calendarId)}/${encodeURIComponent(t.google_event_id)}`, {
              method: 'PATCH', body: JSON.stringify(corpo),
            }, doc);
            synced++;
          } else {
            const ev = await chamarGoogle(accessToken, eventos(calendarId), {
              method: 'POST', body: JSON.stringify(corpo),
            }, doc);
            if (ev?.id) {
              // Só o vínculo muda: a titularidade da tarefa é a mesma, logo as
              // permissões do documento continuam válidas.
              await db.update('tasks', t.$id, { google_event_id: ev.id });
              synced++;
            }
          }
        } catch (e) {
          // Consentimento retirado invalida o lote inteiro: não adianta seguir.
          if (e.codigo === 'google_reconnect_required') throw e;
          falhas++;
          error(`google-calendar-sync: tarefa ${t.$id} falhou — ${e.message}`);
        }
      }

      await marcarSincronizado();
      log(`google-calendar-sync: export tenant ${tenantId} — ${synced}/${tarefas.length} (${falhas} falhas)`);
      return res.json({ success: true, synced, failed: falhas, total: tarefas.length });
    }

    const e = new Error(`action desconhecida: ${action ?? '(vazia)'}`);
    e.status = 400; throw e;
  } catch (e) {
    error(`google-calendar-sync: ${e.message}`);
    return res.json({ ok: false, error: e.message, ...(e.codigo ? { code: e.codigo } : {}) }, e.status || 500);
  }
};
