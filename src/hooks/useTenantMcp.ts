import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenantContext } from '@/hooks/useTenantContext';
import { findOne, Query } from '@/integrations/appwrite/database';

export interface TenantApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_by: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface TenantAuditEntry {
  id: string;
  tenant_id: string;
  api_key_id: string | null;
  tool: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

const SCOPES_ALL = [
  'tasks:read',
  'tasks:write',
  'reminders:write',
  'prioritize',
  'projects:read',
  'members:read',
] as const;

export type Scope = (typeof SCOPES_ALL)[number];
export const ALL_SCOPES: readonly Scope[] = SCOPES_ALL;

/**
 * Mensagem única para tudo que depende de uma Function de gestão de chaves.
 * Melhor um erro explícito na tela do que um 401 cru do Appwrite.
 */
const SEM_FUNCTION =
  'Gestão de chaves MCP ainda não migrada: tenant_api_keys é uma collection de servidor '
  + 'e precisa de uma Appwrite Function para criar, revogar e listar as chaves.';

export function useTenantMcp() {
  const { activeTenantId, myRole } = useTenantContext();
  const qc = useQueryClient();
  // `get_tenant_role` (RPC do Postgres) não existe mais: o papel vem do
  // useTenantContext, que lê tenant_members no cliente.
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const settings = useQuery({
    queryKey: ['tenant-mcp-settings', activeTenantId],
    enabled: !!activeTenantId,
    queryFn: async () => {
      // `tenant_mcp_settings` é server-doc: o servidor concede LEITURA por
      // documento aos membros do tenant, então o findOne funciona no cliente.
      // (No Postgres o recorte era a policy "Tenant members can read mcp settings".)
      return findOne('tenant_mcp_settings', [Query.equal('tenant_id', activeTenantId!)]);
    },
  });

  const keys = useQuery({
    queryKey: ['tenant-api-keys', activeTenantId],
    enabled: !!activeTenantId && isAdmin,
    queryFn: async (): Promise<TenantApiKey[]> => {
      // TODO(migração): `tenant_api_keys` é access 'server' — o cliente não
      // enxerga a collection (guarda key_hash). No Postgres a policy
      // "Tenant admins can view api keys" mostrava as colunas não-sensíveis;
      // aqui a listagem tem que vir de uma Function que devolva a projeção
      // segura (sem key_hash). Enquanto ela não existe, a lista fica vazia.
      return [];
    },
  });

  const audit = useQuery({
    queryKey: ['tenant-api-audit', activeTenantId],
    enabled: !!activeTenantId && isAdmin,
    queryFn: async (): Promise<TenantAuditEntry[]> => {
      // TODO(migração): `tenant_api_audit_log` também é access 'server'
      // (quem escreve é a function hermes-mcp). A leitura para a UI depende da
      // mesma Function de gestão citada acima.
      return [];
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (_enabled: boolean) => {
      if (!activeTenantId) throw new Error('no tenant');
      // TODO(migração): o upsert com onConflict 'tenant_id' viraria
      // upsert('tenant_mcp_settings', [Query.equal('tenant_id', ...)], ...),
      // mas a collection é server-doc: o cliente lê e não escreve. Ligar/desligar
      // o MCP passa a ser uma Function (que valida o papel de admin no lugar da
      // policy "Tenant admins can manage mcp settings").
      throw new Error(SEM_FUNCTION);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-mcp-settings', activeTenantId] }),
  });

  const createKey = useMutation({
    mutationFn: async (_input: { name: string; scopes: Scope[]; expiresInDays?: number | null }): Promise<{ record: TenantApiKey; token: string }> => {
      if (!activeTenantId) throw new Error('no tenant');
      // TODO(migração): a geração do token e o hash SHA-256 saem do navegador.
      // Motivo: o segredo em claro só pode existir na resposta de quem o cria, e
      // `tenant_api_keys` é access 'server' — o cliente não escreve nem lê.
      // A Function deve sortear o segredo, gravar apenas o hash (é o que a
      // hermes-mcp confere a cada chamada) e devolver o token uma única vez.
      throw new Error(SEM_FUNCTION);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-api-keys', activeTenantId] }),
  });

  const revokeKey = useMutation({
    mutationFn: async (_id: string) => {
      // TODO(migração): update de revoked_at em collection 'server' — Function.
      throw new Error(SEM_FUNCTION);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-api-keys', activeTenantId] }),
  });

  const deleteKey = useMutation({
    mutationFn: async (_id: string) => {
      // TODO(migração): delete em collection 'server' — Function.
      throw new Error(SEM_FUNCTION);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-api-keys', activeTenantId] }),
  });

  return {
    isAdmin,
    enabled: !!settings.data?.enabled,
    settings,
    keys,
    audit,
    toggleEnabled,
    createKey,
    revokeKey,
    deleteKey,
  };
}
