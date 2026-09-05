import { Grid3X3, CalendarDays, MessageSquare, Trophy, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/utils';

/**
 * `curto` existe porque o rótulo cheio não cabe: "Planejamento Semanal"
 * quebrava em duas linhas, empurrava o ícone para cima e desalinhava a barra
 * inteira. A barra de baixo é atalho — o nome completo está no menu lateral.
 */
const items = [
  { key: 'matrix', url: '/', icon: Grid3X3, curto: { 'pt-BR': 'Matriz', en: 'Matrix' } },
  { key: 'weeklyPlanning', url: '/weekly', icon: CalendarDays, curto: { 'pt-BR': 'Semana', en: 'Week' } },
  { key: 'aiChat', url: '/chat', icon: MessageSquare, curto: { 'pt-BR': 'Chat', en: 'Chat' } },
  { key: 'gamification', url: '/gamification', icon: Trophy, curto: { 'pt-BR': 'Conquistas', en: 'Awards' } },
  { key: 'settings', url: '/settings', icon: Settings, curto: { 'pt-BR': 'Ajustes', en: 'Settings' } },
] as const;

export function BottomNav() {
  const { language } = useLanguage();
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-bottom">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const isActive = item.url === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.url);
          return (
            <NavLink
              key={item.url}
              to={item.url}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-muted-foreground transition-colors',
                isActive && 'text-primary'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] leading-none font-medium truncate max-w-full px-0.5">
                {item.curto[language]}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
