import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listDocs, Query } from '@/integrations/appwrite/database';
import { invoke } from '@/integrations/appwrite/functions';
import { useAuth } from '@/hooks/useAuth';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  joined_at: string;
}

interface TenantContextType {
  tenants: Tenant[];
  activeTenant: Tenant | null;
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  myRole: TenantMember['role'] | null;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [activeTenantId, setActiveTenantId] = useState<string | null>(() => {
    return localStorage.getItem('active_tenant_id');
  });

  const tenantsQuery = useQuery({
    queryKey: ['my-tenants', user?.$id],
    queryFn: async (): Promise<Tenant[]> => {
      if (!user) return [];
      // Só chegam os tenants cuja permissão de documento inclui este usuário —
      // é o que substitui a policy "Tenant members can view their tenant".
      const docs = await listDocs('tenants', [Query.orderAsc('created_at')]);
      return docs as unknown as Tenant[];
    },
    enabled: !!user,
  });

  const membershipsQuery = useQuery({
    queryKey: ['my-tenant-memberships', user?.$id],
    queryFn: async (): Promise<TenantMember[]> => {
      if (!user) return [];
      const docs = await listDocs('tenant_members', [Query.equal('user_id', user.$id)]);
      return docs as unknown as TenantMember[];
    },
    enabled: !!user,
  });

  const tenants = tenantsQuery.data ?? [];
  const queryClient = useQueryClient();

  // Substitui o trigger handle_new_user_tenant: todo usuário nasce com um
  // tenant pessoal. Sem ele, nada que é por organização (Google Calendar,
  // WhatsApp corporativo, MCP) tem contexto para funcionar. A Function é
  // idempotente — se o usuário já pertence a algum tenant, não cria nada —
  // e o ref evita disparar duas vezes no mesmo ciclo de render.
  const criandoPessoal = useRef(false);
  const semTenant = !tenantsQuery.isLoading && !membershipsQuery.isLoading
    && tenants.length === 0 && (membershipsQuery.data?.length ?? 0) === 0;
  useEffect(() => {
    if (!user || !semTenant || criandoPessoal.current) return;
    criandoPessoal.current = true;
    invoke('create-tenant', { personal: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
        queryClient.invalidateQueries({ queryKey: ['my-tenant-memberships'] });
        queryClient.invalidateQueries({ queryKey: ['tenants'] });
      })
      // Se a Function ainda não foi implantada, o app segue sem tenant — a tela
      // de Organização continua permitindo criar uma à mão quando ela subir.
      .catch((e: Error) => console.warn('tenant pessoal não criado:', e?.message))
      .finally(() => { criandoPessoal.current = false; });
  }, [user, semTenant, queryClient]);

  // Auto-select first tenant if none selected
  useEffect(() => {
    if (!activeTenantId && tenants.length > 0) {
      setActiveTenantId(tenants[0].id);
    }
  }, [tenants, activeTenantId]);

  // Persist active tenant
  useEffect(() => {
    if (activeTenantId) {
      localStorage.setItem('active_tenant_id', activeTenantId);
    } else {
      localStorage.removeItem('active_tenant_id');
    }
  }, [activeTenantId]);

  const activeTenant = tenants.find(t => t.id === activeTenantId) ?? null;
  const memberships = membershipsQuery.data ?? [];
  const myRole = memberships.find(m => m.tenant_id === activeTenantId)?.role ?? null;

  return (
    <TenantContext.Provider value={{
      tenants,
      activeTenant,
      activeTenantId,
      setActiveTenantId,
      myRole,
      isLoading: tenantsQuery.isLoading || membershipsQuery.isLoading,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenantContext() {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenantContext must be used within TenantProvider');
  return context;
}
