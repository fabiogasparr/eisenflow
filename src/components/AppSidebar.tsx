import { Grid3X3, FolderKanban, BarChart3, Settings, LogOut, Zap, CalendarDays, Trophy, Users, MessageSquare, Share2, ShieldCheck, Building2, CheckCircle2 } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenantContext } from '@/hooks/useTenantContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { t, language } = useLanguage();
  const { signOut, user } = useAuth();
  const location = useLocation();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const { tenants, activeTenant, setActiveTenantId } = useTenantContext();

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle()
      .then(({ data }) => setIsSuperAdmin(!!data));
  }, [user]);

  const items = [
    { title: t('matrix'), url: '/', icon: Grid3X3 },
    { title: t('weeklyPlanning'), url: '/weekly', icon: CalendarDays },
    { title: t('projects'), url: '/projects', icon: FolderKanban },
    { title: t('teams'), url: '/teams', icon: Users },
    { title: t('delegated'), url: '/delegated', icon: Share2 },
    { title: t('aiChat'), url: '/chat', icon: MessageSquare },
    { title: t('metrics'), url: '/metrics', icon: BarChart3 },
    { title: t('completed'), url: '/completed', icon: CheckCircle2 },
    { title: t('gamification'), url: '/gamification', icon: Trophy },
    { title: language === 'pt-BR' ? 'Organização' : 'Organization', url: '/organization', icon: Building2 },
    { title: t('settings'), url: '/settings', icon: Settings },
    ...(isSuperAdmin ? [{ title: 'Admin', url: '/admin', icon: ShieldCheck }] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-display text-lg font-bold tracking-tight">EisenFlow</span>
          )}
        </div>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/'}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'default'}
          className="w-full justify-start text-muted-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">{t('logout')}</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
