import { createContext, useContext, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
    queryKey: ['my-tenants', user?.id],
    queryFn: async (): Promise<Tenant[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Tenant[];
    },
    enabled: !!user,
  });

  const membershipsQuery = useQuery({
    queryKey: ['my-tenant-memberships', user?.id],
    queryFn: async (): Promise<TenantMember[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tenant_members')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data ?? []) as TenantMember[];
    },
    enabled: !!user,
  });

  const tenants = tenantsQuery.data ?? [];

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
