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
      {/*
        ALTURA PRESA À JANELA, e não `min-h-screen`.
        Com `min-h-screen` nada tinha altura definida: a cadeia
        `flex-1 min-h-0` da matriz e das colunas da semana não tinha contra o
        que resolver, então os painéis cresciam com o conteúdo e quem rolava
        era a PÁGINA. Medido em 1440x721: o <main> da Matriz tinha 2636px de
        altura — dos quatro quadrantes só dois cabiam na tela, e os ScrollArea
        de dentro nunca entravam em ação. Com a altura presa, o <main> é o
        único elemento que rola e cada painel rola por dentro.
        `dvh` porque no celular a barra do navegador some e volta: `vh` fixo
        deixaria um pedaço da tela sempre cortado.
      */}
      <div className="flex h-screen h-[100dvh] w-full overflow-hidden">
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
