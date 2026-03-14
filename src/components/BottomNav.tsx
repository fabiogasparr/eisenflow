import { Grid3X3, CalendarDays, MessageSquare, Trophy, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/utils';

const items = [
  { key: 'matrix', url: '/', icon: Grid3X3 },
  { key: 'weeklyPlanning', url: '/weekly', icon: CalendarDays },
  { key: 'aiChat', url: '/chat', icon: MessageSquare },
  { key: 'gamification', url: '/gamification', icon: Trophy },
  { key: 'settings', url: '/settings', icon: Settings },
] as const;

export function BottomNav() {
  const { t } = useLanguage();
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
              <span className="text-[10px] leading-tight font-medium">
                {t(item.key as any)}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
