/**
 * O GoTrue devolve o resultado do link de e-mail no fragmento da URL
 * (#access_token=... em caso de sucesso, #error=...&error_description=... em
 * caso de link expirado/já usado). O supabase-js consome esse fragmento e
 * limpa a URL assim que o cliente é criado — antes de qualquer componente
 * montar. Por isso guardamos o fragmento original AQUI, num módulo que o
 * main.tsx importa antes de tudo, para conseguir avisar o usuário do que
 * aconteceu em vez de deixá-lo numa tela vazia com "/#" na barra.
 */
export const hashInicial: string =
  typeof window !== 'undefined' ? window.location.hash : '';

export interface ResultadoDoLinkDeEmail {
  tipo: 'sucesso' | 'erro' | 'nenhum';
  /** signup, recovery, invite, magiclink... quando o GoTrue informa */
  acao?: string;
  codigo?: string;
  descricao?: string;
}

export function lerResultadoDoLinkDeEmail(hash = hashInicial): ResultadoDoLinkDeEmail {
  const bruto = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!bruto) return { tipo: 'nenhum' };

  const p = new URLSearchParams(bruto);
  const erro = p.get('error') || p.get('error_code');
  if (erro) {
    return {
      tipo: 'erro',
      codigo: p.get('error_code') || p.get('error') || undefined,
      descricao: p.get('error_description') || undefined,
    };
  }
  if (p.get('access_token')) {
    return { tipo: 'sucesso', acao: p.get('type') || undefined };
  }
  return { tipo: 'nenhum' };
}
