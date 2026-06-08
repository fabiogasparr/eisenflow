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

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  if (loading) return null;
  const redirect = searchParams.get('redirect') || '/';
  if (user) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <Routes>
    <Route path="/auth" element={<PublicRoute><Auth /></PublicRoute>} />
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
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <TenantProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
          </TenantProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
