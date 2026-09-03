/**
 * tenant-whatsapp-connect
 * ──────────────────────────────────────────────────────────────────────
 * Cria (ou reaproveita) a instância do WhatsApp corporativo do tenant no
 * Evolution GO, declara o webhook e devolve o QR code.
 *
 * Origem: supabase/functions/tenant-whatsapp-connect/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario + papel owner/admin no tenant
 * Entrada .......... { tenant_id }
 * Saída ............ { ok, instance_name, qr_code, status }
 * Lê ............... tenant_members, tenants, tenant_whatsapp_connections
 * Escreve .......... tenant_whatsapp_connections  (server-doc)
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                    EVOLUTION_WEBHOOK_SECRET, PUBLIC_WEBHOOK_BASE_URL
 *
 * É o gêmeo de `whatsapp-connect` no nível do tenant; valem as mesmas três
 * mudanças do Evolution GO (webhook declarado no connect, instância identificada
 * pelo token, QR rotativo) e o mesmo aviso: O QR EXPIRA (~60s o primeiro, ~20s
 * os seguintes). O painel do workspace repola o documento a cada 4s — quem
 * mantém `qr_code` fresco é o evento `QRCode` do `whatsapp-webhook`; a resposta
 * desta chamada é só o primeiro código.
 *
 * MUDANÇA DE SEGURANÇA: o original chamava a RPC `get_tenant_role`; aqui é
 * `requireTenantAdmin()`, que barra membro comum antes de tocar na Evolution.
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser, requireTenantAdmin } from '../_shared/auth.js';
import { evolution, webhookUrl } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';

/** Mesmo formato do original — 16 chars do uuid bastam para não colidir. */
const nomeDaInstancia = (tenantId) => `tenant_${String(tenantId).replace(/-/g, '').slice(0, 16)}`;

/** Ver a nota gêmea em whatsapp-connect: criar -> ou recuperar o token pela listagem. */
async function garantirInstancia(nome, conn, log) {
  if (conn?.instance_token) return { token: conn.instance_token, id: conn.instance_id || null };
  try {
    const nova = await evolution.createInstance(nome);
    log(`tenant-whatsapp-connect: instância ${nome} criada (${nova.id})`);
    return { token: nova.token, id: nova.id };
  } catch (e) {
    const existentes = await evolution.listInstances().catch(() => []);
    const achada = (Array.isArray(existentes) ? existentes : []).find((i) => i?.name === nome);
    if (!achada?.token) throw e;
    log(`tenant-whatsapp-connect: instância ${nome} já existia, token recuperado da listagem`);
    return { token: achada.token, id: achada.id || null };
  }
}

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const { tenant_id: tenantId } = body(req);
    if (!tenantId) { const e = new Error('tenant_id é obrigatório'); e.status = 400; throw e; }

    await requireTenantAdmin(db, tenantId, user.$id);

    const conn = await db.findOne('tenant_whatsapp_connections', [Query.equal('tenant_id', tenantId)]);
    const nome = conn?.instance_name || nomeDaInstancia(tenantId);
    const { token, id } = await garantirInstancia(nome, conn, log);

    await evolution.connect(token, { webhookUrl: webhookUrl(), immediate: true });

    const estado = await evolution.status(token).catch(() => null);
    let qrCode = null;
    if (!estado?.LoggedIn) {
      try {
        const qr = await evolution.qr(token);
        qrCode = qr?.Qrcode || null;
      } catch (e) {
        log(`tenant-whatsapp-connect: QR indisponível no momento (${e.message})`);
      }
    }

    const status = estado?.LoggedIn && estado?.Connected ? 'connected' : (qrCode ? 'qr_pending' : 'disconnected');
    const dados = { instance_name: nome, instance_token: token, instance_id: id, status, qr_code: qrCode };

    if (conn) {
      await db.update('tenant_whatsapp_connections', conn.$id, dados);
    } else {
      // server-doc. A leitura vai para o Team do tenant inteiro (mesma intenção
      // de tenantPermissions() em src/integrations/appwrite/permissions.ts): o
      // painel do workspace mostra o estado da conexão a qualquer membro, e é
      // dele que depende o fluxo de verificação de telefone. O QR fica visível
      // ao time enquanto o pareamento estiver pendente — restringir a leitura a
      // `team:<id>/admin` esconderia também o status dos membros comuns.
      const tenant = await db.get('tenants', tenantId).catch(() => null);
      const teamId = tenant?.appwrite_team_id;
      await db.create(
        'tenant_whatsapp_connections',
        { tenant_id: tenantId, created_by: user.$id, ...dados },
        teamId ? [`read("team:${teamId}")`, `read("user:${user.$id}")`] : [`read("user:${user.$id}")`],
      );
    }

    log(`tenant-whatsapp-connect: ${nome} -> ${status}`);
    return res.json({ ok: true, instance_name: nome, qr_code: qrCode, status });
  } catch (e) {
    error(`tenant-whatsapp-connect: ${e.message}`);
    return err(res, e);
  }
};
