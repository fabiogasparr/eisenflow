/**
 * whatsapp-disconnect
 * ──────────────────────────────────────────────────────────────────────
 * Desloga o aparelho, apaga a instância no Evolution GO e limpa o registro local.
 *
 * Origem: supabase/functions/whatsapp-disconnect/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { keep_instance?: boolean }  — opcional, ver abaixo
 * Saída ............ { status:'disconnected', instance_deleted, logged_out }
 * Lê ............... whatsapp_connections
 * Escreve .......... whatsapp_connections
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 *
 * LOGOUT vs DELETE — são coisas diferentes no Evolution GO:
 *   `DELETE /instance/logout` (token da instância) despareia o aparelho; a
 *   instância continua existindo, com o mesmo token, pronta para novo QR.
 *   `DELETE /instance/delete/{uuid}` (chave global) destrói a instância; o token
 *   morre junto.
 * O original fazia OS DOIS, nessa ordem — e é o que fazemos por padrão. Como a
 * instância deixa de existir, `instance_token`/`instance_id` também são zerados
 * no documento: manter um token morto faria `whatsapp-status` e `whatsapp-send`
 * falharem com 401 em vez de dizerem "desconectado".
 * `keep_instance: true` faz só o logout, preservando o token para um novo
 * pareamento sem recriar a instância (o front ainda não usa; existe porque a
 * distinção agora é real).
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser } from '../_shared/auth.js';
import { evolution } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const { keep_instance: manterInstancia = false } = body(req);

    const conn = await db.findOne('whatsapp_connections', [Query.equal('user_id', user.$id)]);
    if (!conn) return res.json({ status: 'disconnected', instance_deleted: false, logged_out: false });

    let deslogou = false;
    let apagou = false;

    // Desconectar é operação de "chegar no estado desconectado": falha em
    // qualquer etapa remota não pode impedir a limpeza local, senão o usuário
    // fica preso a um registro que não consegue mais desfazer.
    if (conn.instance_token) {
      try { await evolution.logout(conn.instance_token); deslogou = true; }
      catch (e) { log(`whatsapp-disconnect: logout falhou (${e.message})`); }
    } else {
      log('whatsapp-disconnect: sem instance_token gravado — só a limpeza local é possível');
    }

    if (!manterInstancia && conn.instance_id) {
      try { await evolution.deleteInstance(conn.instance_id); apagou = true; }
      catch (e) { log(`whatsapp-disconnect: delete da instância falhou (${e.message})`); }
    }

    await db.update('whatsapp_connections', conn.$id, {
      status: 'disconnected',
      qr_code: null,
      phone_number: null,
      ...(manterInstancia ? {} : { instance_token: null, instance_id: null }),
    });

    log(`whatsapp-disconnect: ${conn.instance_name} (logout=${deslogou}, delete=${apagou})`);
    return res.json({ status: 'disconnected', instance_deleted: apagou, logged_out: deslogou });
  } catch (e) {
    error(`whatsapp-disconnect: ${e.message}`);
    return err(res, e);
  }
};
