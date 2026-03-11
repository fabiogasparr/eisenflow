import { Search, Globe, Moon, Sun } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTheme } from '@/hooks/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AppHeaderProps {
  onSearch?: (query: string) => void;
}

export function AppHeader({ onSearch }: AppHeaderProps) {
  const { t, language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-card/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="shrink-0" />

      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('search')}
          className="pl-9 h-9 bg-secondary/50 border-0"
          onChange={(e) => onSearch?.(e.target.value)}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
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
      </div>
    </header>
  );
}
