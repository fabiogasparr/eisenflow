import { Link } from 'react-router-dom';
import { Zap, Grid2x2, CalendarDays, MessageSquare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Home pública do EisenFlow.
 *
 * A raiz "/" é protegida e manda quem não está logado para o /auth — uma tela
 * de login não descreve o produto, e a verificação do Google exige uma home
 * acessível sem login que explique o que o app faz e leve à política de
 * privacidade. É esta página.
 */
const RECURSOS = [
  {
    icone: Grid2x2,
    titulo: 'Matriz de Eisenhower',
    texto:
      'Suas tarefas em quatro quadrantes — urgente/importante — para você decidir o que fazer agora, o que agendar, o que delegar e o que descartar.',
  },
  {
    icone: CalendarDays,
    titulo: 'Google Calendar',
    texto:
      'Se você conectar sua conta Google, cada tarefa vira um evento na agenda que você escolher, e some de lá quando a tarefa é concluída ou apagada.',
  },
  {
    icone: MessageSquare,
    titulo: 'Lembretes no WhatsApp',
    texto:
      'Conecte seu WhatsApp para receber lembretes dos prazos e criar tarefas por mensagem, sem abrir o app.',
  },
  {
    icone: Sparkles,
    titulo: 'Classificação assistida por IA',
    texto:
      'O texto da tarefa pode ser analisado para sugerir urgência, importância e subtarefas. A sugestão é sempre sua para aceitar ou recusar.',
  },
];

export default function Inicio() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="font-display text-lg font-bold">EisenFlow</span>
          </div>
          <Button asChild size="sm">
            <Link to="/auth">Entrar</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 text-center sm:py-24">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Decida o que merece o seu dia
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            O EisenFlow organiza suas tarefas pela Matriz de Eisenhower e liga isso à sua agenda e ao
            seu WhatsApp — para o planejamento sobreviver ao contato com a semana real.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Criar conta</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-6 pb-16 sm:grid-cols-2">
          {RECURSOS.map(({ icone: Icone, titulo, texto }) => (
            <div key={titulo} className="rounded-xl border border-border bg-card p-6">
              <Icone className="h-5 w-5 text-primary" />
              <h2 className="mt-3 font-display text-lg font-semibold">{titulo}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{texto}</p>
            </div>
          ))}
        </section>

        <section className="mb-16 rounded-xl border border-border bg-muted/30 p-6">
          <h2 className="font-display text-lg font-semibold">Sobre os seus dados</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            As integrações com Google e WhatsApp são opcionais e ligadas por você. Os dados obtidos
            da sua conta Google são usados apenas para manter a sincronia entre tarefas e eventos —
            não são vendidos, não alimentam publicidade e não são enviados a modelos de inteligência
            artificial. O detalhe está na{' '}
            <Link to="/privacidade" className="text-primary underline underline-offset-4">
              Política de Privacidade
            </Link>
            .
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-xs text-muted-foreground">
          <Link to="/privacidade" className="hover:text-foreground">Política de Privacidade</Link>
          <Link to="/termos" className="hover:text-foreground">Termos de Serviço</Link>
          <a href="mailto:fabio.gasparr@gmail.com" className="hover:text-foreground">Contato</a>
          <span className="ml-auto">KZ3 Consultoria em Tecnologia Ltda · CNPJ 50.812.328/0001-80</span>
        </div>
      </footer>
    </div>
  );
}
