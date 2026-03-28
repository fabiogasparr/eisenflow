import { Search, Globe, Moon, Sun, Target, Plus, Building2, Check, MoreVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import { NotificationCenter } from '@/components/NotificationCenter';
import { useTenantContext } from '@/hooks/useTenantContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

interface AppHeaderProps {
  onSearch?: (query: string) => void;
  onFocusMode?: () => void;
  onCreateTask?: () => void;
}

export function AppHeader({ onSearch, onFocusMode, onCreateTask }: AppHeaderProps) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { tenants, activeTenant, setActiveTenantId } = useTenantContext();

  return (
    <header className="flex h-14 items-center gap-1.5 sm:gap-3 border-b bg-card/80 backdrop-blur-sm px-2 sm:px-4">
      <SidebarTrigger className="shrink-0" />

      {/* Tenant Selector */}
      {tenants.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground shrink-0 max-w-[140px] sm:max-w-[180px] px-1.5 sm:px-2">
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="truncate text-xs hidden sm:inline">{activeTenant?.name || '—'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {language === 'pt-BR' ? 'Organização' : 'Organization'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tenants.map((tenant) => (
              <DropdownMenuItem
                key={tenant.id}
                onClick={() => setActiveTenantId(tenant.id)}
                className="gap-2"
              >
                {tenant.logo_url ? (
                  <img src={tenant.logo_url} alt="" className="h-4 w-4 rounded object-cover" />
                ) : (
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="truncate flex-1">{tenant.name}</span>
                {activeTenant?.id === tenant.id && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="relative flex-1 max-w-md hidden sm:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('search')}
          className="pl-9 h-9 bg-secondary/50 border-0"
          onChange={(e) => onSearch?.(e.target.value)}
        />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {onFocusMode && (
          <Button variant="outline" size="icon" onClick={onFocusMode} className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:gap-1.5">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">{language === 'pt-BR' ? 'Modo Foco' : 'Focus Mode'}</span>
          </Button>
        )}
        {onCreateTask && (
          <Button size="icon" onClick={onCreateTask} className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 sm:gap-1.5 shadow-lg">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">{t('addTask')}</span>
          </Button>
        )}
        <NotificationCenter />

        {/* Desktop: separate buttons */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hidden sm:inline-flex h-8 w-8">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hidden sm:inline-flex">
              <Globe className="h-4 w-4" />
              <span className="text-xs uppercase">{language === 'pt-BR' ? 'PT' : 'EN'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLanguage('pt-BR')}>
              🇧🇷 Português (BR)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLanguage('en')}>
              🇺🇸 English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mobile: grouped menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground sm:hidden h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
              {theme === 'dark' ? (language === 'pt-BR' ? 'Modo Claro' : 'Light Mode') : (language === 'pt-BR' ? 'Modo Escuro' : 'Dark Mode')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setLanguage('pt-BR')}>
              🇧🇷 Português (BR)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLanguage('en')}>
              🇺🇸 English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
