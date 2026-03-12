import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';

interface AppLayoutProps {
  children: React.ReactNode;
  onSearch?: (query: string) => void;
  onFocusMode?: () => void;
  onCreateTask?: () => void;
}

export function AppLayout({ children, onSearch, onFocusMode, onCreateTask }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <AppHeader onSearch={onSearch} onFocusMode={onFocusMode} onCreateTask={onCreateTask} />
          <main className="flex-1 overflow-auto min-h-0">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
