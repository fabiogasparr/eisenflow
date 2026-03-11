import { Bell, CheckCheck, Trash2, Clock, UserPlus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReminders, type Reminder } from '@/hooks/useReminders';
import { useNotifications, type DbNotification } from '@/hooks/useNotifications';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';

type UnifiedItem =
  | { source: 'reminder'; data: Reminder; date: Date }
  | { source: 'notification'; data: DbNotification; date: Date };

function ReminderTypeIcon({ type }: { type: Reminder['type'] }) {
  const colors: Record<Reminder['type'], string> = {
    at_deadline: 'text-destructive',
    '1h_before': 'text-quadrant-schedule',
    '1d_before': 'text-primary',
  };
  return <Clock className={`h-4 w-4 shrink-0 ${colors[type]}`} />;
}

function ReminderTypeLabel({ type, lang }: { type: Reminder['type']; lang: string }) {
  const labels: Record<Reminder['type'], Record<string, string>> = {
    '1d_before': { 'pt-BR': 'Prazo amanhã', en: 'Due tomorrow' },
    '1h_before': { 'pt-BR': 'Prazo em 1h', en: 'Due in 1h' },
    at_deadline: { 'pt-BR': 'Prazo agora!', en: 'Due now!' },
  };
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {labels[type][lang] || labels[type].en}
    </span>
  );
}

export function NotificationCenter() {
  const {
    reminders,
    unreadCount: reminderUnread,
    markAsRead: markReminderRead,
    markAllAsRead: markAllRemindersRead,
    clearAll: clearAllReminders,
  } = useReminders();

  const {
    notifications,
    unreadCount: notifUnread,
    markAsRead: markNotifRead,
    markAllAsRead: markAllNotifsRead,
    clearAll: clearAllNotifs,
  } = useNotifications();

  const { language } = useLanguage();
  const locale = language === 'pt-BR' ? ptBR : enUS;

  const totalUnread = reminderUnread + notifUnread;

  // Merge into unified list sorted by date desc
  const items: UnifiedItem[] = [
    ...reminders.map((r) => ({ source: 'reminder' as const, data: r, date: r.triggeredAt })),
    ...notifications.map((n) => ({ source: 'notification' as const, data: n, date: new Date(n.created_at) })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const handleMarkAllRead = () => {
    markAllRemindersRead();
    markAllNotifsRead();
  };

  const handleClearAll = () => {
    clearAllReminders();
    clearAllNotifs();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground">
          <Bell className="h-4 w-4" />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="font-display text-sm font-semibold">
            {language === 'pt-BR' ? 'Notificações' : 'Notifications'}
          </h4>
          <div className="flex gap-1">
            {totalUnread > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="h-7 gap-1 text-xs">
                <CheckCheck className="h-3 w-3" />
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-7 gap-1 text-xs text-muted-foreground">
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-72">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">
                {language === 'pt-BR' ? 'Nenhuma notificação' : 'No notifications'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                if (item.source === 'reminder') {
                  const reminder = item.data;
                  return (
                    <button
                      key={`r-${reminder.id}`}
                      onClick={() => markReminderRead(reminder.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        !reminder.read ? 'bg-primary/5' : ''
                      }`}
                    >
                      <ReminderTypeIcon type={reminder.type} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${!reminder.read ? 'font-medium' : 'text-muted-foreground'}`}>
                          {reminder.taskTitle}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ReminderTypeLabel type={reminder.type} lang={language} />
                          <span className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(reminder.triggeredAt, { addSuffix: true, locale })}
                          </span>
                        </div>
                      </div>
                      {!reminder.read && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                }

                // DB notification
                const notif = item.data;
                const isDelegation = notif.type === 'task_delegated';
                const isStatusChange = notif.type === 'task_status_changed';
                return (
                  <button
                    key={`n-${notif.id}`}
                    onClick={() => markNotifRead(notif.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      !notif.read ? 'bg-primary/5' : ''
                    }`}
                  >
                    {isDelegation ? (
                      <UserPlus className="h-4 w-4 shrink-0 text-accent-foreground" />
                    ) : isStatusChange ? (
                      <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${!notif.read ? 'font-medium' : 'text-muted-foreground'}`}>
                        {notif.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">{notif.body}</span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale })}
                        </span>
                      </div>
                    </div>
                    {!notif.read && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
