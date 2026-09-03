/**
 * Tokens do Google Calendar — o que sobrou no cliente.
 *
 * O QUE MUDOU NA MIGRAÇÃO
 * -----------------------
 * Este arquivo cifrava, gravava e lia os tokens OAuth do Google usando o Vault
 * do backend antigo e a tabela `google_calendar_tokens`. Nada disso existe mais aqui:
 *
 * - A CIFRAGEM E A GRAVAÇÃO DO TOKEN DO GOOGLE ACONTECEM AGORA DENTRO DA
 *   FUNCTION `google-calendar-auth`, NO SERVIDOR, com `node:crypto` e a chave
 *   `GOOGLE_TOKENS_ENCRYPTION_KEY` (as RPCs de pgcrypto não foram migradas).
 * - `google_calendar_tokens` é uma collection SERVER-ONLY: o cliente não lê nem
 *   escreve. No backend antigo o cliente conseguia ler os tokens — isso era uma falha,
 *   e fechá-la é uma melhoria deliberada desta migração.
 * - O antigo `logTokenOperation` virou escrita da própria Function em
 *   `google_token_audit_log`.
 *
 * Consequência prática: O CLIENTE NÃO TOCA EM TOKEN. As funções abaixo mantêm
 * os nomes exportados, mas todas lançam erro — exceto `deleteTokens()`, que tem
 * equivalente real (a action `disconnect` da Function). Nenhuma delas finge
 * funcionar em silêncio.
 */

import { invoke } from '@/integrations/appwrite/functions';

/** Erro único para tudo que passou a ser exclusivo do servidor. */
function apenasNoServidor(funcao: string): never {
  throw new Error(
    `[tokenEncryption] ${funcao}() é operação de servidor: os tokens do Google são cifrados e ` +
      'gravados dentro da Function google-calendar-auth. O cliente não tem acesso a eles.',
  );
}

export interface DecryptedTokenData {
  accessToken: string;
  refreshToken: string;
}

/**
 * Cifragem de token. Feita no servidor, com node:crypto, dentro da Function.
 */
export async function encryptToken(_token: string, _masterKey: string): Promise<string> {
  apenasNoServidor('encryptToken');
}

/**
 * Decifragem de token. Idem: só a Function decifra, e só para falar com o Google.
 */
export async function decryptToken(_encryptedToken: string, _masterKey: string): Promise<string> {
  apenasNoServidor('decryptToken');
}

/**
 * Antes: upsert em google_calendar_tokens após a troca do code por token.
 * Agora isso é o miolo do callback de `google-calendar-auth`.
 */
export async function saveEncryptedTokens(
  _userId: string,
  _accessToken: string,
  _refreshToken: string | null,
  _expiresIn: number,
  _googleEmail?: string,
): Promise<void> {
  apenasNoServidor('saveEncryptedTokens');
}

/**
 * Antes: lia e decifrava o token para uso.
 * O cliente não pode nem ler a collection — quem precisa do token é a Function
 * `google-calendar-sync`, que o busca por conta própria.
 */
export async function getDecryptedTokens(_userId: string): Promise<DecryptedTokenData | null> {
  apenasNoServidor('getDecryptedTokens');
}

/**
 * Antes: regravava o access token cifrado depois de um refresh.
 * A renovação acontece no servidor, sozinha, quando o token expira.
 */
export async function rotateAccessToken(
  _userId: string,
  _newAccessToken: string,
  _expiresIn: number,
): Promise<void> {
  apenasNoServidor('rotateAccessToken');
}

/**
 * Único caso com equivalente no cliente: desconectar o Google Calendar.
 * A Function apaga o registro de token e escreve a auditoria; aqui só pedimos.
 * O `userId` sumiu de propósito — a Function age sobre a sessão de quem chamou,
 * ninguém desconecta a conta de outro pelo navegador.
 */
export async function deleteTokens(): Promise<void> {
  await invoke('google-calendar-auth', { action: 'disconnect' });
}
