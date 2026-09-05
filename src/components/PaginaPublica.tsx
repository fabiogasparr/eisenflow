import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

/**
 * Moldura das páginas públicas (início, privacidade, termos).
 *
 * Existe porque a verificação do Google exige três páginas acessíveis SEM
 * login, no domínio autorizado, que se referenciem entre si: a home descreve o
 * app, e política e termos precisam estar linkados de onde o usuário entra.
 */
export function PaginaPublica({
  titulo,
  atualizadoEm,
  children,
}: {
  titulo: string;
  atualizadoEm?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/inicio" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="font-display text-lg font-bold">EisenFlow</span>
          </Link>
          <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{titulo}</h1>
        {atualizadoEm && (
          <p className="mt-1 text-sm text-muted-foreground">Atualizado em {atualizadoEm}</p>
        )}
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-xs text-muted-foreground">
          <Link to="/inicio" className="hover:text-foreground">Início</Link>
          <Link to="/privacidade" className="hover:text-foreground">Política de Privacidade</Link>
          <Link to="/termos" className="hover:text-foreground">Termos de Serviço</Link>
          <span className="ml-auto">KZ3 Consultoria em Tecnologia Ltda · CNPJ 50.812.328/0001-80</span>
        </div>
      </footer>
    </div>
  );
}

export default PaginaPublica;
