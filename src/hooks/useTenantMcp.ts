import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantContext } from '@/hooks/useTenantContext';

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

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function useTenantMcp() {
  const { activeTenantId, myRole } = useTenantContext();
  const qc = useQueryClient();
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const settings = useQuery({
    queryKey: ['tenant-mcp-settings', activeTenantId],
    enabled: !!activeTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_mcp_settings' as any)
        .select('*')
        .eq('tenant_id', activeTenantId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const keys = useQuery({
    queryKey: ['tenant-api-keys', activeTenantId],
    enabled: !!activeTenantId && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_api_keys' as any)
        .select('id, tenant_id, name, key_prefix, scopes, created_by, last_used_at, last_used_ip, expires_at, revoked_at, created_at')
        .eq('tenant_id', activeTenantId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TenantApiKey[];
    },
  });

  const audit = useQuery({
    queryKey: ['tenant-api-audit', activeTenantId],
    enabled: !!activeTenantId && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_api_audit_log' as any)
        .select('id, tenant_id, api_key_id, tool, status, error, created_at')
        .eq('tenant_id', activeTenantId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as TenantAuditEntry[];
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!activeTenantId) throw new Error('no tenant');
      const { data: user } = await supabase.auth.getUser();
      const payload = { tenant_id: activeTenantId, enabled, updated_by: user.user?.id };
      const { error } = await supabase
        .from('tenant_mcp_settings' as any)
        .upsert(payload, { onConflict: 'tenant_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-mcp-settings', activeTenantId] }),
  });

  const createKey = useMutation({
    mutationFn: async (input: { name: string; scopes: Scope[]; expiresInDays?: number | null }) => {
      if (!activeTenantId) throw new Error('no tenant');
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error('not authenticated');
      const tenantPrefix = activeTenantId.replace(/-/g, '').slice(0, 6);
      const secret = randomToken();
      const token = `efk_${tenantPrefix}_${secret}`;
      const hash = await sha256Hex(token);
      const expires =
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const { data, error } = await supabase
        .from('tenant_api_keys' as any)
        .insert({
          tenant_id: activeTenantId,
          name: input.name,
          key_prefix: `efk_${tenantPrefix}`,
          key_hash: hash,
          scopes: input.scopes,
          created_by: userId,
          expires_at: expires,
        })
        .select()
        .single();
      if (error) throw error;
      return { record: data as any, token };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-api-keys', activeTenantId] }),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tenant_api_keys' as any)
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-api-keys', activeTenantId] }),
  });

  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tenant_api_keys' as any).delete().eq('id', id);
      if (error) throw error;
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
