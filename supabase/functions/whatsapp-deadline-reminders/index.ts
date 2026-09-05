/**
 * whatsapp-deadline-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Cron a cada 15 min: avisa por WhatsApp as tarefas vencendo agora, na
 * próxima 1h e nas próximas 24h — respeitando o horário e o fuso de cada
 * usuário, e sem repetir aviso já enviado.
 *
 * Chamada ........... pg_cron (x-internal-secret ou service role)
 * Entrada ........... nenhuma
 * Saída ............. { ok, sent }
 * Lê ................ whatsapp_connections, tasks
 * Lê/Escreve ........ whatsapp_sent_reminders (e limpa as antigas)
 * Env ............... EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET
 *
 * O QUE IMPEDE O REENVIO: o índice único (user_id, task_id, reminder_type) de
 * whatsapp_sent_reminders — `upsert(..., ignoreDuplicates)` deixa o Postgres
 * decidir.
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  - O original convertia fuso com `new Date(now.toLocaleString('en-US', {timeZone}))`,
 *    que depende do parser de data do runtime e erra em fusos com meia hora de
 *    offset. Aqui a hora local vem de Intl.DateTimeFormat.
 *  - O fallback "busca o telefone na Evolution" saiu: a Evolution GO não expõe o
 *    dono da instância. Quem preenche phone_number é o whatsapp-webhook, na
 *    primeira mensagem própria que chega, ou o whatsapp-status pelo `jid`.
 *  - Envio por evolution.sendText(instance_token, ...) — a instância é o token.
 *  - Passou a exigir chamada interna (era aberta).
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { evolution } from '../_shared/evolution.ts';
import { json, preflight, respostaErro } from '../_shared/http.ts';

const FUSO_PADRAO = 'America/Sao_Paulo';
const TOLERANCIA_MIN = 30;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Minutos desde a meia-noite no fuso do usuário. */
function minutosLocais(tz: string, agora: Date): number {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_PADRAO, hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** O usuário configura "08:00,12:00,18:00"; ±30 min é a janela do original. */
function estaNaJanela(reminderTimes: string | null, minutosAgora: number): boolean {
  const horarios = String(reminderTimes || '08:00,12:00,18:00').split(',').map((t) => t.trim()).filter(Boolean);
  return horarios.some((t) => {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h)) return false;
    const alvo = h * 60 + (m || 0);
    const diff = Math.abs(minutosAgora - alvo);
    return diff <= TOLERANCIA_MIN || diff >= 24 * 60 - TOLERANCIA_MIN; // vira a meia-noite
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    requireInternal(req);
    const db = admin();

    limparAntigos().catch((e) => console.error(`whatsapp-deadline-reminders: limpeza falhou: ${e.message}`));

    const { data: conexoes, error } = await db
      .from('whatsapp_connections')
      .select('*')
      .eq('status', 'connected')
      .eq('reminders_enabled', true);
    if (error) throw error;
    console.log(`whatsapp-deadline-reminders: ${conexoes?.length ?? 0} conexões com lembretes ligados`);

    const agora = new Date();
    const em24h = new Date(agora.getTime() + 24 * 3600e3);
    let enviados = 0;

    for (const conn of conexoes ?? []) {
      const minutos = minutosLocais(conn.timezone || FUSO_PADRAO, agora);
      if (!estaNaJanela(conn.reminder_times, minutos)) continue;
      if (!conn.phone_number || !conn.instance_token) {
        console.log(`whatsapp-deadline-reminders: conexão ${conn.id} sem número ou token, pulando`);
        continue;
      }

      try {
        const enviou = await avisar(conn, agora, em24h);
        if (enviou) enviados++;
      } catch (e) {
        console.error(`whatsapp-deadline-reminders: falhou para ${conn.user_id}: ${(e as Error).message}`);
      }
    }

    console.log(`whatsapp-deadline-reminders: ${enviados} avisos enviados`);
    return json({ ok: true, sent: enviados });
  } catch (e) {
    console.error('whatsapp-deadline-reminders:', e);
    return respostaErro(e);
  }
});

async function avisar(conn: Row, agora: Date, em24h: Date): Promise<boolean> {
  const db = admin();
  // Tarefas do usuário (criadas por ele OU atribuídas a ele) vencendo até 24h.
  const { data: tarefas, error } = await db
    .from('tasks')
    .select('id, title, due_date')
    .or(`created_by.eq.${conn.user_id},assigned_to.eq.${conn.user_id}`)
    .in('status', ['pending', 'in_progress'])
    .not('due_date', 'is', null)
    .gte('due_date', agora.toISOString())
    .lte('due_date', em24h.toISOString())
    .order('due_date', { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!tarefas?.length) return false;

  // Quais já foram avisados — a consulta evita 1 escrita perdida por tarefa.
  const { data: jaEnviados } = await db
    .from('whatsapp_sent_reminders')
    .select('task_id, reminder_type')
    .eq('user_id', conn.user_id)
    .in('task_id', tarefas.map((t: Row) => t.id));
  const enviado = new Set((jaEnviados ?? []).map((r: Row) => `${r.task_id}:${r.reminder_type}`));

  const grupos: Record<string, Row[]> = { now: [], '1h': [], '24h': [] };
  for (const t of tarefas) {
    const falta = new Date(t.due_date).getTime() - agora.getTime();
    const tipo = falta <= 0 ? 'now' : falta <= 3600e3 ? '1h' : '24h';
    if (enviado.has(`${t.id}:${tipo}`)) continue;
    grupos[tipo].push(t);
  }

  const total = grupos.now.length + grupos['1h'].length + grupos['24h'].length;
  if (!total) return false;

  const linhas = ['⏰ *Lembretes de Prazo*\n'];
  const bloco = (titulo: string, lista: Row[]) => {
    if (!lista.length) return;
    linhas.push(titulo);
    lista.forEach((t, i) => linhas.push(`  ${i + 1}. ${t.title}`));
    linhas.push('');
  };
  bloco('🔴 *Vencendo agora:*', grupos.now);
  bloco('🟡 *Próxima 1 hora:*', grupos['1h']);
  bloco('🔵 *Próximas 24 horas:*', grupos['24h']);
  linhas.push('Use /listar para ver detalhes.');

  await evolution.sendText(conn.instance_token, conn.phone_number, linhas.join('\n'));
  console.log(`whatsapp-deadline-reminders: ${total} tarefas avisadas a ${conn.user_id}`);

  // Só marca depois do envio dar certo: falhou o envio, o próximo ciclo tenta de novo.
  const carimbo = new Date().toISOString();
  const registros: Row[] = [];
  for (const [tipo, lista] of Object.entries(grupos)) {
    for (const t of lista) registros.push({ user_id: conn.user_id, task_id: t.id, reminder_type: tipo, sent_at: carimbo });
  }
  if (registros.length) {
    // ignoreDuplicates: outro ciclo pode ter registrado no meio — não é erro.
    const { error: e2 } = await db
      .from('whatsapp_sent_reminders')
      .upsert(registros, { onConflict: 'user_id,task_id,reminder_type', ignoreDuplicates: true });
    if (e2) throw e2;
  }
  return true;
}

/** Registro de envio serve por 48h; depois é só peso morto na tabela. */
async function limparAntigos(): Promise<void> {
  const limite = new Date(Date.now() - 48 * 3600e3).toISOString();
  await admin().from('whatsapp_sent_reminders').delete().lt('sent_at', limite);
}
