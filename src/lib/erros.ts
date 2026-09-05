/**
 * Tradução de erro técnico em aviso útil.
 *
 * A regra: o usuário precisa saber (1) o que falhou, (2) por que, e (3) o que
 * ele pode fazer. "Failed to fetch" não responde nenhuma das três — é o texto
 * cru que o navegador usa quando a requisição nem chegou ao servidor.
 */

export type Idioma = 'pt-BR' | 'en';

export interface Aviso {
  titulo: string;
  descricao: string;
  /** Mensagem original, para o rodapé "detalhes" e para o console. */
  detalhe?: string;
  /** true quando a falha é de rede/servidor, não de dado do usuário. */
  falhaDeRede?: boolean;
}

export function idiomaAtual(): Idioma {
  try {
    return localStorage.getItem('eisenflow-lang') === 'en' ? 'en' : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

/** Host da API, para dizer ao usuário QUAL endereço não respondeu. */
export function hostDaApi(): string {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL as string).host;
  } catch {
    return 'o servidor';
  }
}

function texto(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; error_description?: unknown; msg?: unknown };
  return String(e.message ?? e.error_description ?? e.msg ?? err);
}

function codigo(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; error_code?: unknown };
  return String(e.code ?? e.error_code ?? e.status ?? '');
}

/** A falha aconteceu antes de o servidor responder? */
export function ehFalhaDeRede(err: unknown): boolean {
  const t = texto(err).toLowerCase();
  return (
    t.includes('failed to fetch') ||
    t.includes('networkerror') ||
    t.includes('network request failed') ||
    t.includes('load failed') ||
    t.includes('err_connection') ||
    t.includes('err_name_not_resolved') ||
    t.includes('err_cert') ||
    t.includes('fetch failed')
  );
}

interface Regra {
  quando: (t: string, c: string) => boolean;
  ptTitulo: string;
  ptDescricao: string;
  enTitulo: string;
  enDescricao: string;
  falhaDeRede?: boolean;
}

const REGRAS: Regra[] = [
  {
    // Só vale quando a mensagem também cheira a falha de transporte (ou está
    // vazia). Estar offline não transforma "senha muito curta" em problema
    // de rede — e transformar seria mentir para o usuário.
    quando: (t) =>
      typeof navigator !== 'undefined' &&
      navigator.onLine === false &&
      (!t ||
        t.includes('failed to fetch') ||
        t.includes('networkerror') ||
        t.includes('network request failed') ||
        t.includes('load failed') ||
        t.includes('fetch failed')),
    ptTitulo: 'Você está sem internet',
    ptDescricao:
      'O navegador está offline. Nada foi salvo. Reconecte e tente de novo — sua tela continua como está.',
    enTitulo: 'You are offline',
    enDescricao:
      'The browser has no connection. Nothing was saved. Reconnect and try again.',
    falhaDeRede: true,
  },
  {
    quando: (t) =>
      t.includes('failed to fetch') ||
      t.includes('networkerror') ||
      t.includes('network request failed') ||
      t.includes('load failed') ||
      t.includes('fetch failed'),
    ptTitulo: 'Não consegui falar com o servidor',
    ptDescricao: `A requisição não chegou a ${'{HOST}'}. Pode ser conexão instável, DNS ainda propagando ou o servidor fora do ar. Nada foi alterado — tente novamente em alguns segundos.`,
    enTitulo: 'Could not reach the server',
    enDescricao: `The request never got to ${'{HOST}'}. It may be a flaky connection, DNS still propagating, or the server being down. Nothing changed — try again in a few seconds.`,
    falhaDeRede: true,
  },
  {
    quando: (t, c) => t.includes('aborted') || t.includes('timeout') || c === '408' || c === '504',
    ptTitulo: 'O servidor demorou demais',
    ptDescricao:
      'A resposta não chegou a tempo. A operação pode ou não ter sido concluída — recarregue a página antes de repetir.',
    enTitulo: 'The server took too long',
    enDescricao:
      'No answer in time. The operation may or may not have completed — reload before retrying.',
    falhaDeRede: true,
  },
  {
    quando: (t) => t.includes('invalid login credentials'),
    ptTitulo: 'E-mail ou senha incorretos',
    ptDescricao:
      'Confira os dados. Se não lembra a senha, use "Esqueci minha senha" logo abaixo.',
    enTitulo: 'Wrong e-mail or password',
    enDescricao: 'Check your details, or use "Forgot password" below.',
  },
  {
    quando: (t) => t.includes('email not confirmed'),
    ptTitulo: 'E-mail ainda não confirmado',
    ptDescricao:
      'Abra o link que enviamos para o seu e-mail antes de entrar. Verifique também a caixa de spam.',
    enTitulo: 'E-mail not confirmed yet',
    enDescricao:
      'Open the link we e-mailed you before signing in. Check your spam folder too.',
  },
  {
    quando: (t) => t.includes('user already registered') || t.includes('already been registered'),
    ptTitulo: 'Esse e-mail já tem conta',
    ptDescricao: 'Use "Já tenho conta" para entrar, ou recupere a senha.',
    enTitulo: 'That e-mail already has an account',
    enDescricao: 'Use "I already have an account" to sign in, or reset the password.',
  },
  {
    quando: (t) => t.includes('password should be') || t.includes('weak password'),
    ptTitulo: 'Senha muito fraca',
    ptDescricao: 'Use ao menos 8 caracteres, misturando letras e números.',
    enTitulo: 'Password too weak',
    enDescricao: 'Use at least 8 characters, mixing letters and numbers.',
  },
  {
    quando: (t) =>
      t.includes('for security purposes') ||
      t.includes('rate limit') ||
      t.includes('too many requests'),
    ptTitulo: 'Muitas tentativas seguidas',
    ptDescricao:
      'O servidor pediu uma pausa. Espere cerca de um minuto antes de tentar de novo.',
    enTitulo: 'Too many attempts',
    enDescricao: 'The server asked for a pause. Wait about a minute and try again.',
  },
  {
    quando: (t) => t.includes('signups not allowed') || t.includes('signup is disabled'),
    ptTitulo: 'Cadastro desativado',
    ptDescricao: 'Esta instalação não está aceitando novos cadastros. Fale com o administrador.',
    enTitulo: 'Sign-up disabled',
    enDescricao: 'This installation is not accepting new sign-ups. Talk to the administrator.',
  },
  {
    quando: (t, c) =>
      c === 'PGRST301' || t.includes('jwt expired') || t.includes('invalid claim') || c === '401',
    ptTitulo: 'Sua sessão expirou',
    ptDescricao: 'Entre novamente para continuar. Nada do que você já salvou foi perdido.',
    enTitulo: 'Your session expired',
    enDescricao: 'Sign in again to continue. Nothing you already saved was lost.',
  },
  {
    quando: (t, c) => c === '42501' || t.includes('row-level security') || t.includes('permission denied') || c === '403',
    ptTitulo: 'Sem permissão para isso',
    ptDescricao:
      'Seu usuário não tem acesso a este registro. Se deveria ter, peça ao dono da organização.',
    enTitulo: 'Not allowed',
    enDescricao: 'Your user cannot access this record. Ask the organization owner if you should.',
  },
  {
    quando: (t, c) => c === '23505' || t.includes('duplicate key'),
    ptTitulo: 'Esse registro já existe',
    ptDescricao: 'Já há um item com esses dados. Mude o nome ou edite o existente.',
    enTitulo: 'Record already exists',
    enDescricao: 'There is already an item with this data. Rename it or edit the existing one.',
  },
  {
    quando: (t, c) => c === '23503' || t.includes('foreign key'),
    ptTitulo: 'Há itens ligados a este',
    ptDescricao: 'Remova ou desvincule os itens dependentes antes de excluir este.',
    enTitulo: 'Other items depend on this one',
    enDescricao: 'Remove or unlink the dependent items before deleting this one.',
  },
  {
    quando: (t, c) => c === '500' || c === '502' || c === '503' || t.includes('internal server error') || t.includes('bad gateway'),
    ptTitulo: 'O servidor respondeu com erro',
    ptDescricao:
      'A falha foi do lado do servidor, não do seu dado. Tente de novo; se persistir, avise o administrador.',
    enTitulo: 'The server returned an error',
    enDescricao:
      'The failure was on the server side, not your data. Retry; if it persists, tell the administrator.',
  },
];

export function avisoDeErro(err: unknown, contexto?: string): Aviso {
  const bruto = texto(err);
  const t = bruto.toLowerCase();
  const c = codigo(err);
  const pt = idiomaAtual() === 'pt-BR';

  const regra = REGRAS.find((r) => r.quando(t, c));
  if (regra) {
    const descricao = (pt ? regra.ptDescricao : regra.enDescricao).replace('{HOST}', hostDaApi());
    return {
      titulo: contexto ? `${contexto}: ${pt ? regra.ptTitulo : regra.enTitulo}` : pt ? regra.ptTitulo : regra.enTitulo,
      descricao,
      detalhe: bruto,
      falhaDeRede: regra.falhaDeRede,
    };
  }

  return {
    titulo: contexto ?? (pt ? 'Não deu certo' : 'Something went wrong'),
    descricao: bruto || (pt ? 'Erro sem descrição.' : 'Error with no description.'),
    detalhe: bruto,
  };
}

/** Uma linha só, para lugares onde só cabe texto. */
export function mensagemDeErro(err: unknown): string {
  const a = avisoDeErro(err);
  return `${a.titulo}. ${a.descricao}`;
}

/**
 * Alguns avisos (falha de rede) também alimentam a faixa de conexão no topo.
 * Emitimos um evento em vez de acoplar este módulo ao React.
 */
export const EVENTO_FALHA_DE_REDE = 'eisenflow:falha-de-rede';

export function registrarFalhaDeRede() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FALHA_DE_REDE));
  } catch {
    /* ambiente sem window */
  }
}
