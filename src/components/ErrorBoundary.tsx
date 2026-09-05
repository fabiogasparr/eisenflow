import React from 'react';
import { avisoDeErro, idiomaAtual } from '@/lib/erros';

interface Props {
  children: React.ReactNode;
  /** Nome da área, para o usuário saber o que quebrou. */
  area?: string;
}

interface State {
  erro: Error | null;
  detalhe: string;
}

/**
 * Sem isto, qualquer exceção lançada dentro de um render ou de um useEffect
 * faz o React desmontar a árvore inteira — e o usuário vê uma página preta,
 * sem uma palavra sobre o que houve. Aqui a falha vira uma tela legível, com
 * o que aconteceu e o que fazer a seguir.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { erro: null, detalhe: '' };

  static getDerivedStateFromError(erro: Error): Partial<State> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: React.ErrorInfo) {
    console.error('[EisenFlow] erro não tratado:', erro, info.componentStack);
    this.setState({ detalhe: `${erro.stack ?? erro.message}\n\n${info.componentStack ?? ''}` });
  }

  private recarregar = () => {
    window.location.reload();
  };

  private limparSessao = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-') || k.includes('supabase'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage bloqueado */
    }
    window.location.assign('/auth');
  };

  private copiar = () => {
    navigator.clipboard?.writeText(this.state.detalhe || String(this.state.erro)).catch(() => {});
  };

  render() {
    if (!this.state.erro) return this.props.children;

    const pt = idiomaAtual() === 'pt-BR';
    const aviso = avisoDeErro(this.state.erro);
    const area = this.props.area;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
          <h1 className="text-xl font-semibold text-foreground">
            {pt ? 'Algo quebrou nesta tela' : 'This screen crashed'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {area
              ? pt
                ? `A falha aconteceu em "${area}". O restante do EisenFlow continua funcionando.`
                : `The failure happened in "${area}". The rest of EisenFlow still works.`
              : pt
                ? 'Seus dados estão salvos no servidor — nada foi perdido.'
                : 'Your data is safe on the server — nothing was lost.'}
          </p>

          <div className="mt-4 rounded-lg bg-muted/50 p-3">
            <p className="text-sm font-medium text-foreground">{aviso.titulo}</p>
            <p className="mt-1 text-sm text-muted-foreground">{aviso.descricao}</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.recarregar}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {pt ? 'Recarregar a página' : 'Reload the page'}
            </button>
            <button
              type="button"
              onClick={this.limparSessao}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              {pt ? 'Sair e entrar de novo' : 'Sign out and back in'}
            </button>
            <button
              type="button"
              onClick={this.copiar}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {pt ? 'Copiar detalhes técnicos' : 'Copy technical details'}
            </button>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {pt ? 'Detalhes técnicos' : 'Technical details'}
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {this.state.detalhe || String(this.state.erro)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
