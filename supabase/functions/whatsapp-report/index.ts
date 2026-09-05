/**
 * whatsapp-report
 * ──────────────────────────────────────────────────────────────────────
 * Cron de hora em hora: monta e envia o relatório diário/semanal de
 * produtividade para quem habilitou, no horário do FUSO DO USUÁRIO.
 *
 * Chamada ........... pg_cron (x-internal-secret ou service role)
 * Entrada ........... { type?: 'daily' | 'weekly' } — sem o campo, roda os dois
 * Saída ............. { ok, daily, weekly }
 * Lê ................ whatsapp_connections, tasks, productivity_metrics, gamification
 * Env ............... EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  1. FUSO. O original tinha UTC-3 fixo no código: quem estivesse em Lisboa ou
 *     Manaus recebia o "relatório das 08:00" na hora errada. Agora o corte usa
 *     Intl.DateTimeFormat com whatsapp_connections.timezone.
 *  2. Uma execução cobre diário E semanal. No original só existia um cron e o
 *     semanal dependia de alguém mandar {type:'weekly'} no corpo.
 *  3. Envio por evolution.sendText(instance_token, ...).
 *  4. Passou a exigir chamada interna (era aberta).
 *
 * PENDENTE: tenant_whatsapp_connections também tem daily/weekly_report_enabled,
 * mas não tem user_id nem report_time — não há de quem fazer o relatório.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireInternal } from '../_shared/supabase.ts';
import { evolution } from '../_shared/evolution.ts';
import { relatorioDiario, relatorioSemanal } from '../_shared/relatorios.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

const FUSO_PADRAO = 'America/Sao_Paulo';
const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hora e dia da semana no fuso do usuário — sem dependência de data externa. */
function localDe(tz: string, agora: Date): { hora: number; diaSemana: number } {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false, weekday: 'short' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO_PADRAO, hour: '2-digit', hour12: false, weekday: 'short' });
  }
  const p = Object.fromEntries(fmt.formatToParts(agora).map((x) => [x.type, x.value]));
  return { hora: Number(p.hour) % 24, diaSemana: DIAS[p.weekday] ?? 1 };
}

const horaDe = (hhmmss: string | null | undefined, padrao = 8): number => {
  const h = parseInt(String(hhmmss || '').split(':')[0], 10);
  return Number.isNaN(h) ? padrao : h;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    requireInternal(req);
    const db = admin();

    const pedido = (await lerCorpo(req)).type;
    const tipos: string[] = pedido ? [String(pedido)] : ['daily', 'weekly'];
    const agora = new Date();
    const resultado: Record<string, number | boolean> = { ok: true, daily: 0, weekly: 0 };

    for (const tipo of tipos) {
      const campo = tipo === 'weekly' ? 'weekly_report_enabled' : 'daily_report_enabled';
      const { data: conexoes, error } = await db
        .from('whatsapp_connections')
        .select('*')
        .eq('status', 'connected')
        .eq(campo, true);
      if (error) throw error;

      const alvos = (conexoes ?? []).filter((c) => {
        const { hora, diaSemana } = localDe(c.timezone || FUSO_PADRAO, agora);
        if (tipo === 'weekly') {
          return horaDe(c.weekly_report_time || c.report_time) === hora && (c.weekly_report_day ?? 1) === diaSemana;
        }
        return horaDe(c.report_time) === hora;
      });

      console.log(`whatsapp-report: ${tipo} — ${alvos.length} de ${conexoes?.length ?? 0} conexões no horário`);

      for (const conn of alvos) {
        if (!conn.phone_number || !conn.instance_token) {
          console.log(`whatsapp-report: conexão ${conn.id} sem número ou token, pulando`);
          continue;
        }
        try {
          const texto = tipo === 'weekly'
            ? await relatorioSemanal(conn.user_id, agora)
            : await relatorioDiario(conn.user_id, agora);
          await evolution.sendText(conn.instance_token, conn.phone_number, texto);
          resultado[tipo] = (resultado[tipo] as number) + 1;
        } catch (e) {
          console.error(`whatsapp-report: falhou para ${conn.user_id}: ${(e as Error).message}`);
        }
      }
    }

    return json(resultado);
  } catch (e) {
    console.error('whatsapp-report:', e);
    return respostaErro(e);
  }
});
