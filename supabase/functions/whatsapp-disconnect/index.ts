/**
 * whatsapp-disconnect
 * ──────────────────────────────────────────────────────────────────────
 * Desloga o aparelho, apaga a instância no Evolution GO e limpa o registro local.
 *
 * Chamada ........... front (JWT)
 * Entrada ........... { keep_instance?: boolean }
 * Saída ............. { status:'disconnected', instance_deleted, logged_out }
 * Lê/Escreve ........ whatsapp_connections
 * Env ............... EVOLUTION_API_URL, EVOLUTION_API_KEY
 *
 * LOGOUT vs DELETE — são coisas diferentes no Evolution GO:
 *   `DELETE /instance/logout` (token da instância) despareia o aparelho; a
 *   instância continua existindo, com o mesmo token, pronta para novo QR.
 *   `DELETE /instance/delete/{uuid}` (chave global) destrói a instância; o token
 *   morre junto.
 * O original fazia OS DOIS, nessa ordem — e é o que fazemos por padrão. Como a
 * instância deixa de existir, `instance_token`/`instance_id` também são zerados:
 * manter um token morto faria `whatsapp-status` e `whatsapp-send` falharem com
 * 401 em vez de dizerem "desconectado". `keep_instance: true` faz só o logout.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireUser } from '../_shared/supabase.ts';
import { evolution } from '../_shared/evolution.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const { keep_instance: manterInstancia = false } = await lerCorpo(req);
    const db = admin();

    const { data: conn } = await db.from('whatsapp_connections').select('*').eq('user_id', user.id).maybeSingle();
    if (!conn) return json({ status: 'disconnected', instance_deleted: false, logged_out: false });

    let deslogou = false;
    let apagou = false;

    // Desconectar é operação de "chegar no estado desconectado": falha em
    // qualquer etapa remota não pode impedir a limpeza local, senão o usuário
    // fica preso a um registro que não consegue mais desfazer.
    if (conn.instance_token) {
      try { await evolution.logout(conn.instance_token); deslogou = true; }
      catch (e) { console.log(`whatsapp-disconnect: logout falhou (${(e as Error).message})`); }
    } else {
      console.log('whatsapp-disconnect: sem instance_token gravado — só a limpeza local é possível');
    }

    if (!manterInstancia && conn.instance_id) {
      try { await evolution.deleteInstance(conn.instance_id); apagou = true; }
      catch (e) { console.log(`whatsapp-disconnect: delete da instância falhou (${(e as Error).message})`); }
    }

    const { error } = await db.from('whatsapp_connections').update({
      status: 'disconnected',
      qr_code: null,
      phone_number: null,
      ...(manterInstancia ? {} : { instance_token: null, instance_id: null }),
    }).eq('id', conn.id);
    if (error) throw error;

    console.log(`whatsapp-disconnect: ${conn.instance_name} (logout=${deslogou}, delete=${apagou})`);
    return json({ status: 'disconnected', instance_deleted: apagou, logged_out: deslogou });
  } catch (e) {
    console.error('whatsapp-disconnect:', e);
    return respostaErro(e);
  }
});
