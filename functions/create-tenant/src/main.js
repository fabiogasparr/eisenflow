/**
 * create-tenant
 * ──────────────────────────────────────────────────────────────────────
 * Cria uma organização (tenant) completa: Team nativo do Appwrite, adesão do
 * criador como owner, documento em `tenants` e registro em `tenant_members`.
 *
 * Origem: triggers handle_new_tenant e handle_new_user_tenant do Postgres.
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { name, slug?, logo_url? }            organização nomeada
 *                    { personal: true }                    tenant pessoal (idempotente)
 * Saída ............ { ok, tenant, created }
 * Lê ............... tenant_members, tenants
 * Escreve .......... tenants, tenant_members, Teams
 * Variáveis ........ APPWRITE_API_KEY
 *
 * POR QUE ISTO É UMA FUNCTION E NÃO CÓDIGO DE FRONT
 * Duas coisas aqui só a API key faz: criar Team (o SDK web não cria) e
 * escrever em `tenant_members`, que é server-doc — é a fonte da verdade dos
 * papéis, e deixar o cliente gravar o próprio papel seria deixar qualquer um
 * se promover a owner. No Postgres isso era trigger em transação; aqui são
 * quatro escritas, então a ordem importa e há limpeza em caso de falha.
 *
 * POR QUE `personal`
 * No Supabase, handle_new_user_tenant dava a todo usuário novo um tenant
 * pessoal no cadastro. Sem isso, um usuário recém-criado não tem contexto de
 * organização e tudo que é por tenant (Google Calendar, WhatsApp corporativo,
 * MCP) fica inacessível. O front chama `{personal:true}` no primeiro login;
 * a chamada é idempotente: se o usuário já pertence a algum tenant, devolve o
 * primeiro e não cria nada.
 */
import { db, teams, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';
import { requireUser } from '../_shared/auth.js';
import { body, err } from '../_shared/http.js';

/** tenant_members só tem tenant_id/user_id/role/joined_at — sem carimbos. */
const criarMembro = (tenantId, userId, role) =>
  rawCall('POST', `/databases/${DATABASE_ID}/collections/tenant_members/documents`, {
    documentId: 'unique()',
    data: { tenant_id: tenantId, user_id: userId, role, joined_at: new Date().toISOString() },
    // Espelha serverWritesUserReads(): o dono lê o próprio registro; só a API key escreve.
    permissions: [`read("user:${userId}")`],
  });

/** Slug legível, único por sufixo curto — o índice uniq_tenant_slug é a garantia final. */
function slugDe(nome, sufixo) {
  const base = String(nome || 'organizacao')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'organizacao';
  return sufixo ? `${base}-${sufixo}` : base;
}

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const input = body(req);

    // ---------------------------------------------------- tenant pessoal
    if (input.personal) {
      const existente = await db.findOne('tenant_members', [Query.equal('user_id', user.$id)]);
      if (existente) {
        const tenant = await db.get('tenants', existente.tenant_id).catch(() => null);
        if (tenant) return res.json({ ok: true, tenant, created: false });
        // Membro de um tenant que não existe mais: segue e cria o pessoal.
      }
      const nome = user.name?.trim() || (user.email || '').split('@')[0] || 'Meu espaço';
      return res.json(await criar({ name: nome, slug: slugDe(nome, user.$id.slice(0, 8)) }, user, log));
    }

    // ------------------------------------------------ organização nomeada
    const name = String(input.name || '').trim();
    if (!name) return res.json({ ok: false, error: 'name é obrigatório' }, 400);
    const slug = slugDe(input.slug || name, input.slug ? '' : user.$id.slice(0, 6));
    const logo_url = input.logo_url ? String(input.logo_url).slice(0, 2000) : undefined;

    return res.json(await criar({ name, slug, ...(logo_url ? { logo_url } : {}) }, user, log));
  } catch (e) {
    error(`create-tenant: ${e.message}`);
    return err(res, e);
  }
};

/**
 * Ordem: Team -> adesão -> documento -> membro. O Team vem primeiro porque o
 * id dele entra nas permissões do documento; se qualquer passo seguinte falhar,
 * o Team é apagado para não deixar lixo órfão no projeto.
 */
async function criar(dados, user, log) {
  const team = await teams.create('unique()', dados.name);
  try {
    await teams.createMembership(team.$id, { userId: user.$id, roles: ['owner'] });

    const tenant = await db.create('tenants', {
      ...dados, created_by: user.$id, appwrite_team_id: team.$id,
    }, [
      // "Tenant members can view their tenant" -> leitura para o Team inteiro.
      `read("team:${team.$id}")`,
      // "Tenant owners can update/delete their tenant" -> escrita só do criador.
      `update("user:${user.$id}")`,
      `delete("user:${user.$id}")`,
    ]);

    await criarMembro(tenant.$id, user.$id, 'owner');
    log(`create-tenant: ${tenant.$id} (${dados.slug}) para ${user.$id}`);
    return { ok: true, tenant, created: true };
  } catch (e) {
    await teams.delete(team.$id).catch(() => {});
    // 409 no slug é o único conflito legítimo aqui — devolve algo que o front entende.
    if (e.status === 409) { const c = new Error('Já existe uma organização com esse slug'); c.status = 409; throw c; }
    throw e;
  }
}
