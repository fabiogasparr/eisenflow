import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: React.ReactNode;
  onSearch?: (query: string) => void;
  onFocusMode?: () => void;
  onCreateTask?: () => void;
  mainClassName?: string;
}

export function AppLayout({ children, onSearch, onFocusMode, onCreateTask, mainClassName }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        {/* Sem wrapper `hidden md:block`: o Sidebar do shadcn já se transforma
            em gaveta no celular, e escondê-lo por CSS matava essa gaveta — o
            botão de menu não fazia nada e Projetos, Times, Delegadas, Métricas,
            Concluídas e Organização ficavam inalcançáveis no telefone, porque a
            barra de baixo só tem cinco atalhos. */}
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <AppHeader onSearch={onSearch} onFocusMode={onFocusMode} onCreateTask={onCreateTask} />
          <main className={cn("flex-1 overflow-auto min-h-0 pb-safe-14 md:pb-0", mainClassName)}>
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </SidebarProvider>
  );
}
