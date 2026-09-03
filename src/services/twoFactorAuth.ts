/**
 * Autenticação de dois fatores (2FA / MFA).
 *
 * O QUE MUDOU NA MIGRAÇÃO
 * -----------------------
 * As tabelas `user_2fa` e `failed_2fa_attempts` NÃO foram migradas de propósito:
 * o Appwrite tem MFA nativo. Na prática isso troca uma implementação caseira —
 * que guardava o segredo TOTP em texto no banco e cujo `verifyTOTPCode()
 * retornava `true` sem verificar nada — pelo fluxo do servidor:
 *
 *   setupTotp()      -> cria o autenticador TOTP e devolve segredo + URI do QR
 *   confirmTotp(otp) -> o SERVIDOR valida o código e marca o fator como verificado
 *   enableMfa()      -> passa a exigir o segundo fator no login
 *   listMfaFactors() -> diz quais fatores estão ativos na conta
 *
 * Tudo isso vem de `@/integrations/appwrite/auth`. Contagem de tentativas
 * erradas e bloqueio também são do servidor (o Appwrite tem rate limit próprio
 * nos endpoints de auth), por isso as funções de "failed attempts" deixaram de
 * existir aqui.
 *
 * Os nomes exportados foram mantidos para não quebrar quem importa; o que não
 * tem equivalente client-side LANÇA erro em vez de devolver um `true` educado.
 */

import { setupTotp, confirmTotp, enableMfa, listMfaFactors } from '@/integrations/appwrite/auth';

/** Erro único para o que saiu do cliente. */
function naoMigrado(funcao: string, detalhe: string): never {
  throw new Error(`[twoFactorAuth] ${funcao}() não existe mais no cliente: ${detalhe}`);
}

/**
 * Gerador de segredo base32.
 * Mantido por compatibilidade de assinatura, mas NÃO é mais usado no fluxo: o
 * segredo TOTP quem gera é o Appwrite, em `setupUserTwoFA()`.
 */
export function generateTOTPSecret(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let secret = '';
  for (let i = 0; i < length; i++) secret += chars[bytes[i] % chars.length];
  return secret;
}

/**
 * Gerador de códigos de backup.
 * Mantido por compatibilidade; os códigos de recuperação de verdade são os do
 * Appwrite (`account.createMfaRecoveryCodes()`) — ver TODO em setupUserTwoFA.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let code = '';
    for (let j = 0; j < 8; j++) code += chars[bytes[j] % chars.length];
    codes.push(code);
  }
  return codes;
}

/**
 * Antes: um placeholder que devolvia `true` para qualquer código de 6 dígitos —
 * ou seja, 2FA que não verificava nada. Agora quem confere o código é o
 * servidor do Appwrite (`confirmTotp` / desafio de MFA no login).
 */
export function verifyTOTPCode(_secret: string, _code: string): boolean {
  naoMigrado(
    'verifyTOTPCode',
    'a verificação do TOTP é feita pelo servidor do Appwrite (confirmTotp / desafio de MFA).',
  );
}

/**
 * Monta a URI otpauth:// para o QR code.
 * Continua útil quando se quer desenhar o QR à mão, mas o `setupTotp()` do
 * Appwrite já devolve a URI pronta — prefira a dele.
 */
export function generateTOTPProvisioningURI(
  secret: string,
  email: string,
  issuer: string = 'EisenFlow',
): string {
  const encodedEmail = encodeURIComponent(email);
  const encodedIssuer = encodeURIComponent(issuer);

  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&digits=6&period=30`;
}

/**
 * Inicia o 2FA: cria o autenticador TOTP na conta logada e devolve o segredo e
 * a URI para o QR code. O fator ainda NÃO vale — precisa passar por
 * `verifyAndEnable2FA()` com um código do app autenticador.
 *
 * TODO(migração): os códigos de recuperação do Appwrite vêm de
 * `account.createMfaRecoveryCodes()`, que ainda não está encapsulado em
 * `@/integrations/appwrite/auth`. Enquanto não estiver, esta função não
 * devolve `backup_codes` — melhor não devolver do que devolver códigos que
 * ninguém aceita no login.
 */
export async function setupUserTwoFA(): Promise<{ secret: string; provisioning_uri: string }> {
  const authenticator = await setupTotp();
  return {
    secret: authenticator.secret,
    provisioning_uri: authenticator.uri,
  };
}

/**
 * Confirma o código do app autenticador e liga o MFA na conta.
 * O parâmetro `userId` sumiu: as chamadas nativas agem sobre a sessão atual.
 */
export async function verifyAndEnable2FA(totpCode: string): Promise<boolean> {
  try {
    await confirmTotp(totpCode);
    await enableMfa();
    return true;
  } catch (err) {
    console.error('Failed to verify 2FA:', err);
    return false;
  }
}

/**
 * Antes: conferia o TOTP no login lendo user_2fa.
 * Agora o segundo fator no login é um DESAFIO do servidor
 * (`account.createMfaChallenge` + `account.updateMfaChallenge`).
 *
 * TODO(migração): expor esses dois em `@/integrations/appwrite/auth` quando a
 * tela de login com MFA for implementada.
 */
export async function validateTOTPCode(_userId: string, _totpCode: string): Promise<boolean> {
  naoMigrado(
    'validateTOTPCode',
    'o segundo fator do login é um desafio do servidor (createMfaChallenge/updateMfaChallenge).',
  );
}

/**
 * Antes: consumia um código da coluna backup_codes.
 * Agora o código de recuperação é um FATOR do desafio de MFA do Appwrite
 * (factor 'recoverycode'), resolvido pelo mesmo fluxo de desafio.
 *
 * TODO(migração): idem validateTOTPCode.
 */
export async function useBackupCode(_userId: string, _backupCode: string): Promise<boolean> {
  naoMigrado(
    'useBackupCode',
    "código de recuperação vira o fator 'recoverycode' do desafio de MFA nativo.",
  );
}

/**
 * Desligar o MFA precisa de duas chamadas nativas — `account.updateMFA(false)` e
 * a remoção do autenticador (`account.deleteMfaAuthenticator('totp')`), esta
 * última exigindo a senha/otp do usuário.
 *
 * TODO(migração): encapsular as duas em `@/integrations/appwrite/auth` (hoje só
 * existe `enableMfa()`) e então implementar aqui.
 */
export async function disable2FA(_userId?: string): Promise<boolean> {
  naoMigrado(
    'disable2FA',
    'falta encapsular account.updateMFA(false) e account.deleteMfaAuthenticator("totp") em appwrite/auth.',
  );
}

/**
 * A conta logada tem TOTP ativo? Responde pelos fatores nativos.
 * O `userId` deixou de importar: a resposta é sempre sobre a sessão atual.
 */
export async function is2FAEnabled(_userId?: string): Promise<boolean> {
  try {
    const factors = await listMfaFactors();
    return factors.totp === true;
  } catch {
    return false;
  }
}

/**
 * Antes: RPC log_failed_2fa_attempt gravando em failed_2fa_attempts.
 * A tabela não foi migrada — quem conta tentativa errada é o próprio Appwrite,
 * que já aplica rate limit nos endpoints de autenticação.
 */
export async function logFailed2FAAttempt(
  _userId: string,
  _ipAddress?: string,
  _userAgent?: string,
): Promise<void> {
  naoMigrado(
    'logFailed2FAAttempt',
    'failed_2fa_attempts não foi migrada; o Appwrite conta e limita as tentativas no servidor.',
  );
}

/**
 * Antes: RPC get_failed_2fa_attempts.
 * Devolver 0 daqui seria mentir sobre um número que o cliente não tem.
 */
export async function getFailedAttempts(
  _userId: string,
  _minutesBack: number = 30,
): Promise<number> {
  naoMigrado('getFailedAttempts', 'a contagem vive no servidor do Appwrite, não em uma collection.');
}

/**
 * Antes: bloqueava o usuário por excesso de tentativas.
 * Um `false` silencioso aqui viraria buraco de segurança: o bloqueio é do
 * servidor (rate limit nativo do Appwrite).
 */
export async function shouldBlockUser(_userId: string, _maxAttempts: number = 5): Promise<boolean> {
  naoMigrado('shouldBlockUser', 'o bloqueio por tentativas é aplicado pelo rate limit nativo do Appwrite.');
}

/**
 * Antes: sorteava novos backup codes e gravava em user_2fa.
 * Agora são os códigos de recuperação nativos.
 *
 * TODO(migração): encapsular `account.createMfaRecoveryCodes()` (primeira vez) e
 * `account.updateMfaRecoveryCodes()` (regeneração) em `@/integrations/appwrite/auth`.
 */
export async function regenerateBackupCodes(_userId?: string): Promise<string[]> {
  naoMigrado(
    'regenerateBackupCodes',
    'falta encapsular account.updateMfaRecoveryCodes() em appwrite/auth.',
  );
}
