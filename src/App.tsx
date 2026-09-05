import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useSearchParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { TenantProvider } from "@/hooks/useTenantContext";
import Index from "./pages/Index";
import Metrics from "./pages/Metrics";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import SettingsPage from "./pages/SettingsPage";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import WeeklyPlanner from "./pages/WeeklyPlanner";
import Gamification from "./pages/Gamification";
import TeamsPage from "./pages/TeamsPage";
import AIChatPage from "./pages/AIChatPage";
import DelegatedPage from "./pages/DelegatedPage";
import JoinTeamPage from "./pages/JoinTeamPage";
import AdminPage from "./pages/AdminPage";
import OrganizationPage from "./pages/OrganizationPage";
import CompletedTasks from "./pages/CompletedTasks";
import IntegrationsMcpPage from "./pages/IntegrationsMcpPage";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";
import AvisoDeConexao from "@/components/AvisoDeConexao";
import AvisoDoLinkDeEmail from "@/components/AvisoDoLinkDeEmail";

const queryClient = new QueryClient();

function Carregando() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Carregando />;
  if (!user) return <Navigate to="/auth" replace />;
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  // Antes devolvia null: enquanto a sessão era resolvida a tela ficava preta,
  // e se getSession() falhasse por rede ela ficava preta para sempre.
  if (loading) return <Carregando />;
  const redirect = searchParams.get('redirect') || '/';
  if (user) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
    <Route path="/auth/forgot" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
    {/* Destino do link do e-mail de recuperação (redirectTo de resetPasswordForEmail).
        Fica FORA do PublicRoute de propósito: ao abrir o link, o GoTrue cria uma
        sessão de recuperação — o usuário passa a estar "logado" — e o PublicRoute
        o mandaria para a home antes de ele conseguir digitar a nova senha. */}
    <Route path="/auth/recovery" element={<ResetPassword />} />
    <Route path="/invite/:code" element={<JoinTeamPage />} />
    <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
    <Route path="/metrics" element={<ProtectedRoute><Metrics /></ProtectedRoute>} />
    <Route path="/completed" element={<ProtectedRoute><CompletedTasks /></ProtectedRoute>} />
    <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
    <Route path="/projects/:id" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
    <Route path="/weekly" element={<ProtectedRoute><WeeklyPlanner /></ProtectedRoute>} />
    <Route path="/gamification" element={<ProtectedRoute><Gamification /></ProtectedRoute>} />
    <Route path="/teams" element={<ProtectedRoute><TeamsPage /></ProtectedRoute>} />
    <Route path="/delegated" element={<ProtectedRoute><DelegatedPage /></ProtectedRoute>} />
    <Route path="/chat" element={<ProtectedRoute><AIChatPage /></ProtectedRoute>} />
    <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
    <Route path="/organization" element={<ProtectedRoute><OrganizationPage /></ProtectedRoute>} />
    <Route path="/integrations/mcp" element={<ProtectedRoute><IntegrationsMcpPage /></ProtectedRoute>} />
    <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  // O ErrorBoundary externo é a última rede de segurança: sem ele, uma exceção
  // em qualquer provider ou efeito desmontava a árvore e o usuário via só uma
  // página preta, sem uma linha explicando o que aconteceu.
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <TenantProvider>
              <TooltipProvider>
                <AvisoDeConexao />
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <AvisoDoLinkDeEmail />
                  <AppRoutes />
                </BrowserRouter>
              </TooltipProvider>
            </TenantProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
