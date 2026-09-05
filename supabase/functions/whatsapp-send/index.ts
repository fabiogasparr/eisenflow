/**
 * whatsapp-send
 * ──────────────────────────────────────────────────────────────────────
 * Envia uma mensagem de texto pelo Evolution GO.
 *
 * Chamada ........... server-to-server com `x-internal-secret` (ou service role)
 * Entrada ........... { instance_token | instance_name, phone_number, message }
 * Saída ............. { success:true, data } | { ok:false, error }
 * Lê ................ whatsapp_connections, tenant_whatsapp_connections (só no
 *                     caminho de compatibilidade por instance_name)
 * Env ............... EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET
 *
 * FALHA DE SEGURANÇA CORRIGIDA: a versão Lovable não tinha autenticação
 * nenhuma — qualquer pessoa com a URL disparava mensagens por qualquer
 * instância conectada. Agora:
 *   - chamada interna (x-internal-secret ou service role): pode usar qualquer
 *     instância, por token ou por nome;
 *   - usuário autenticado (JWT): só consegue enviar pela PRÓPRIA conexão
 *     pessoal, para não quebrar o `useReminders` do front, que dispara o
 *     lembrete local pelo WhatsApp do próprio usuário. Qualquer
 *     instance_name/instance_token que ele mande é ignorado.
 *
 * MUDANÇA DA API v2 PARA O EVOLUTION GO: a assinatura virou
 * `sendText(instanceToken, number, text)`. Não existe mais `{instance}` no path
 * nem envio com a chave global — quem identifica e autoriza a instância é o
 * TOKEN dela. `instance_name` continua aceito por compatibilidade: o token é
 * resolvido consultando as conexões pelo nome.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, getUser, isInternalCall, segredoInterno } from '../_shared/supabase.ts';
import { evolution } from '../_shared/evolution.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

/** Compatibilidade: acha o token da instância pelo nome, pessoal ou de tenant. */
async function tokenPeloNome(nome: string): Promise<string> {
  const db = admin();
  const { data: pessoal } = await db.from('whatsapp_connections').select('instance_token').eq('instance_name', nome).maybeSingle();
  if (pessoal?.instance_token) return pessoal.instance_token;

  const { data: tenant } = await db.from('tenant_whatsapp_connections').select('instance_token').eq('instance_name', nome).maybeSingle();
  if (tenant?.instance_token) return tenant.instance_token;

  if (pessoal || tenant) {
    throw erro(`A conexão "${nome}" não tem instance_token gravado (criada antes da migração para o Evolution GO). É preciso reconectar o WhatsApp.`, 409);
  }
  throw erro(`Nenhuma conexão encontrada para a instância "${nome}"`, 404);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    if (!segredoInterno()) throw erro('INTERNAL_FUNCTION_SECRET não configurado', 500);

    const corpo = await lerCorpo(req);
    const { instance_token: instanceToken, instance_name: instanceName, phone_number: telefone, message } = corpo;
    if (!telefone || !message) throw erro('phone_number e message são obrigatórios', 400);

    let token: string;
    let origem: string;

    if (isInternalCall(req)) {
      if (!instanceToken && !instanceName) throw erro('instance_token (ou instance_name) é obrigatório', 400);
      token = instanceToken || (await tokenPeloNome(instanceName));
      origem = instanceName || 'token';
    } else {
      // Usuário comum: só a própria conexão pessoal, e só se estiver conectada.
      const user = await getUser(req);
      if (!user) throw erro('não autorizado', 401);
      const { data: conn } = await admin()
        .from('whatsapp_connections')
        .select('instance_name, instance_token, status')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!conn || conn.status !== 'connected' || !conn.instance_token) {
        throw erro('Seu WhatsApp não está conectado', 409);
      }
      token = conn.instance_token;
      origem = conn.instance_name;
    }

    // Só dígitos: o Evolution GO monta o JID sozinho. Não aplicamos normalize()
    // (que força o DDI 55) para não quebrar número internacional já correto.
    const numero = String(telefone).replace(/\D/g, '');
    const data = await evolution.sendText(token, numero, String(message));

    console.log(`whatsapp-send: enviado para ${numero.slice(0, 4)}**** via ${origem}`);
    return json({ success: true, data });
  } catch (e) {
    console.error('whatsapp-send:', e);
    return respostaErro(e);
  }
});
