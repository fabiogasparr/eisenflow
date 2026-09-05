/**
 * google-calendar-sync
 * ──────────────────────────────────────────────────────────────────────
 * CRUD de eventos do Google Calendar e sincronização bidirecional com tasks,
 * por tenant.
 *
 * Chamada ........... front (JWT) — useGoogleCalendar.ts, useGoogleCalendarEvents.ts
 * Entrada ........... { action:'list-calendars'|'list-events'|'create-event'|
 *                       'update-event'|'delete-event'|'import-events'|'sync-tasks',
 *                       tenant_id?, ... }
 * Saída ............. varia por action (contrato do front preservado)
 * Lê ................ google_calendar_tokens, tenant_members, tasks
 * Escreve ........... google_calendar_tokens (last_synced_at, refresh), tasks
 * Env ............... GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                     GOOGLE_TOKENS_ENCRYPTION_KEY
 *
 * O QUE MUDOU EM RELAÇÃO À VERSÃO LOVABLE
 *  1. MULTI-TENANT: a conexão é (user_id, tenant_id); as tarefas tocadas são as
 *     do usuário DENTRO do tenant. Sem tenant_id no corpo, usa o tenant mais
 *     antigo do usuário (compatibilidade com o hook antigo).
 *  2. O original lia/gravava access_token em texto plano aqui e cifrado no auth.
 *     Agora os dois lados usam cripto.ts; o refresh está em _shared/google.ts.
 *  3. invalid_grant/401/403 do Google marcam is_revoked e devolvem
 *     code:'google_reconnect_required' (HTTP 409) para o front pedir reconexão.
 *
 * PRESERVADO DO ORIGINAL (mapeamento tarefa <-> evento)
 *  - vínculo: tasks.google_event_id <-> event.id (1:1)
 *  - export : início = due_date, senão created_at; sem due_date vira evento de
 *             dia inteiro; duração fixa de 1h; título ganha ✅/❌ conforme status
 *  - import : cria tarefa com quadrant 'schedule', status 'pending',
 *             due_date = start.dateTime||start.date; se já existe tarefa com
 *             aquele google_event_id, atualiza só quando algo mudou
 *  - deleção: delete-event ignora 404/410 (evento já não existia no Google)
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireTenantMember, requireUser, tenantPadraoDe } from '../_shared/supabase.ts';
import { acessoValido, buscarConexao, chamarGoogle, GoogleApiError } from '../_shared/google.ts';
import { HttpError, erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const FUSO = 'America/Sao_Paulo'; // igual ao original; o app é BR
const UMA_HORA = 60 * 60 * 1000;
const UM_DIA = 24 * UMA_HORA;

/** Bloco start/end do evento, no formato do Google. Porte direto do original. */
function inicioFim(startDateTime: string, endDateTime: string | undefined, allDay: boolean) {
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

const eventos = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const input = await lerCorpo(req);
    const { action } = input;
    const tenantId: string | null = input.tenant_id || (await tenantPadraoDe(user.id));
    await requireTenantMember(tenantId, user.id);
    const tid = tenantId as string;
    const db = admin();

    const doc = await buscarConexao(tid, user.id);
    // Renova o token se faltar menos de 5 min — antes de qualquer chamada ao Google.
    const { accessToken, calendarId } = await acessoValido(doc);
    const conexao = doc!;

    const marcarSincronizado = () =>
      db.from('google_calendar_tokens').update({ last_synced_at: new Date().toISOString() }).eq('id', conexao.id);

    // ── LIST CALENDARS ──
    if (action === 'list-calendars') {
      const data = await chamarGoogle(accessToken, '/users/me/calendarList?maxResults=250', {}, conexao);
      return json({
        calendars: (data.items || []).map((c: Row) => ({
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
      const data = await chamarGoogle(accessToken, `${eventos(calendarId)}?${p}`, {}, conexao);
      return json({ events: data.items || [] });
    }

    // ── CREATE EVENT ──
    if (action === 'create-event') {
      const { summary, description, startDateTime, endDateTime, allDay } = input;
      if (!summary || !startDateTime) throw erro('summary e startDateTime são obrigatórios', 400);

      const evento = await chamarGoogle(accessToken, eventos(calendarId), {
        method: 'POST',
        body: JSON.stringify({ summary, description: description || '', ...inicioFim(startDateTime, endDateTime, !!allDay) }),
      }, conexao);

      await marcarSincronizado();
      return json({ event: evento });
    }

    // ── UPDATE EVENT ──
    if (action === 'update-event') {
      const { eventId, summary, description, startDateTime, endDateTime, allDay } = input;
      if (!eventId) throw erro('eventId é obrigatório', 400);

      const patch: Row = {};
      if (summary) patch.summary = summary;
      if (description !== undefined) patch.description = description;
      if (startDateTime) Object.assign(patch, inicioFim(startDateTime, endDateTime, !!allDay));

      const evento = await chamarGoogle(accessToken, `${eventos(calendarId)}/${encodeURIComponent(eventId)}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      }, conexao);
      return json({ event: evento });
    }

    // ── DELETE EVENT ──
    if (action === 'delete-event') {
      const { eventId } = input;
      if (!eventId) throw erro('eventId é obrigatório', 400);
      try {
        await chamarGoogle(accessToken, `${eventos(calendarId)}/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, conexao);
      } catch (e) {
        // 404/410 = o evento já não existe no Google. Do ponto de vista do app
        // o resultado desejado (não existir) foi alcançado. Igual ao original.
        const gs = (e as GoogleApiError).googleStatus;
        if (gs !== 404 && gs !== 410) throw e;
      }
      return json({ success: true });
    }

    // ── IMPORT EVENTS (Google → tasks) ──
    if (action === 'import-events') {
      const p = new URLSearchParams({
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + 30 * UM_DIA).toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      });
      const data = await chamarGoogle(accessToken, `${eventos(calendarId)}?${p}`, {}, conexao);
      const lista: Row[] = data.items || [];

      let imported = 0, updated = 0;
      for (const ev of lista) {
        if (!ev.id || !ev.summary) continue;
        const inicio = ev.start?.dateTime || ev.start?.date;
        if (!inicio) continue;

        const { data: existente } = await db
          .from('tasks')
          .select('id, title, description, due_date')
          .eq('google_event_id', ev.id)
          .eq('created_by', user.id)
          .eq('tenant_id', tid)
          .limit(1)
          .maybeSingle();

        if (existente) {
          const precisaAtualizar =
            existente.title !== ev.summary ||
            (existente.description ?? null) !== (ev.description || null) ||
            existente.due_date !== inicio;
          if (precisaAtualizar) {
            await db.from('tasks').update({ title: ev.summary, description: ev.description || null, due_date: inicio }).eq('id', existente.id);
            updated++;
          }
        } else {
          const { error } = await db.from('tasks').insert({
            title: ev.summary,
            description: ev.description || null,
            due_date: inicio,
            google_event_id: ev.id,
            created_by: user.id,
            tenant_id: tid,
            quadrant: 'schedule',
            status: 'pending',
          });
          if (!error) imported++;
          else console.error(`google-calendar-sync: import de "${ev.summary}" falhou — ${error.message}`);
        }
      }

      await marcarSincronizado();
      console.log(`google-calendar-sync: import tenant ${tid} — ${imported} novos, ${updated} atualizados de ${lista.length}`);
      return json({ success: true, imported, updated, total: lista.length });
    }

    // ── SYNC TASKS (tasks → Google) ──
    if (action === 'sync-tasks') {
      const { data: tarefas, error } = await db
        .from('tasks')
        .select('id, title, description, due_date, created_at, google_event_id, status')
        .eq('created_by', user.id)
        .eq('tenant_id', tid);
      if (error) throw error;
      const lista: Row[] = tarefas ?? [];

      let synced = 0, falhas = 0;
      for (const t of lista) {
        const allDay = !t.due_date;
        const inicio = t.due_date || t.created_at;
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
            }, conexao);
            synced++;
          } else {
            const ev = await chamarGoogle(accessToken, eventos(calendarId), {
              method: 'POST', body: JSON.stringify(corpo),
            }, conexao);
            if (ev?.id) {
              await db.from('tasks').update({ google_event_id: ev.id }).eq('id', t.id);
              synced++;
            }
          }
        } catch (e) {
          // Consentimento retirado invalida o lote inteiro: não adianta seguir.
          if ((e as HttpError).codigo === 'google_reconnect_required') throw e;
          falhas++;
          console.error(`google-calendar-sync: tarefa ${t.id} falhou — ${(e as Error).message}`);
        }
      }

      await marcarSincronizado();
      console.log(`google-calendar-sync: export tenant ${tid} — ${synced}/${lista.length} (${falhas} falhas)`);
      return json({ success: true, synced, failed: falhas, total: lista.length });
    }

    throw erro(`action desconhecida: ${action ?? '(vazia)'}`, 400);
  } catch (e) {
    console.error('google-calendar-sync:', e);
    return respostaErro(e);
  }
});
