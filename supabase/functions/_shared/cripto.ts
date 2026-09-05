/**
 * Cifragem simétrica dos tokens do Google e assinatura do `state` do OAuth.
 *
 * As migrations antigas tinham `encrypt_token`/`decrypt_token` em pgcrypto com a
 * chave-mestra literal 'REPLACE_WITH_VAULT_KEY' deixada no código (ver
 * MIGRATION.md, "Três defeitos do schema original"). A cifra passa a acontecer
 * aqui, em WebCrypto do Deno — zero dependência nova, e a chave nunca entra no
 * banco. Porte de functions/_shared/cripto.js (node:crypto -> crypto.subtle).
 *
 * Formato do blob: base64( iv[12] || ciphertext || authTag[16] ).
 * ATENÇÃO: a ordem é diferente do node (iv || tag || ct) porque o WebCrypto
 * devolve o tag COLADO no fim do ciphertext. Não há dado legado a migrar: o
 * banco Supabase é novo.
 *
 * Env:
 *   GOOGLE_TOKENS_ENCRYPTION_KEY  cifra os tokens (texto livre; SHA-256 normaliza)
 *   GOOGLE_STATE_SECRET           HMAC do state do OAuth (cai para a chave acima
 *                                 se ausente — mas prefira segredos separados)
 */
import { base64Decode, base64Encode, base64UrlDecode, base64UrlEncode, hexEncode, timingSafeEqual, utf8Decode, utf8Encode } from './bytes.ts';
import { HttpError } from './http.ts';

const IV_BYTES = 12;   // GCM recomenda 96 bits

/** SHA-256 normaliza a chave configurada para os 32 bytes exigidos pelo AES-256. */
async function chaveBruta(nomeEnv: string, fallbackEnv?: string): Promise<Uint8Array> {
  const bruta = Deno.env.get(nomeEnv) || (fallbackEnv ? Deno.env.get(fallbackEnv) : '');
  if (!bruta) throw new HttpError(`${nomeEnv} não configurada`, 500);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Encode(bruta)));
}

async function chaveAes(): Promise<CryptoKey> {
  const raw = await chaveBruta('GOOGLE_TOKENS_ENCRYPTION_KEY');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function chaveHmac(): Promise<CryptoKey> {
  const raw = await chaveBruta('GOOGLE_STATE_SECRET', 'GOOGLE_TOKENS_ENCRYPTION_KEY');
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Cifra um token do Google. Devolve base64(iv+ciphertext+tag), ou null para vazio. */
export async function cifrar(textoPlano: string | null | undefined): Promise<string | null> {
  if (textoPlano == null || textoPlano === '') return null;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveAes(), utf8Encode(String(textoPlano))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return base64Encode(out);
}

/** Decifra o blob gravado por cifrar(). Lança se a chave mudou ou o dado foi adulterado. */
export async function decifrar(blob: string | null | undefined): Promise<string | null> {
  if (!blob) return null;
  const buf = base64Decode(String(blob));
  if (buf.length <= IV_BYTES + 16) throw new HttpError('token cifrado inválido', 500);
  const iv = buf.subarray(0, IV_BYTES);
  const ct = buf.subarray(IV_BYTES);
  try {
    const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await chaveAes(), ct);
    return utf8Decode(new Uint8Array(plano));
  } catch {
    throw new HttpError('não foi possível decifrar o token do Google (chave alterada ou dado corrompido)', 500);
  }
}

// ------------------------------------------------------------- state do OAuth
// O original mandava o access_token da sessão do Supabase cru no `state` da URL
// de consentimento. Isso é (a) vazamento de credencial em URL e (b) CSRF: nada
// impedia um terceiro de forjar o state e amarrar a SUA conta Google à conta
// dele. Aqui o state é um payload assinado com HMAC-SHA256 e com validade.

export interface StatePayload {
  user_id: string;
  tenant_id: string;
  nonce: string;
  exp: number;
}

export async function assinarState(dados: { user_id: string; tenant_id: string }, validadeSegundos = 600): Promise<string> {
  const payload: StatePayload = {
    ...dados,
    nonce: hexEncode(crypto.getRandomValues(new Uint8Array(16))),
    exp: Math.floor(Date.now() / 1000) + validadeSegundos,
  };
  const corpo = base64UrlEncode(utf8Encode(JSON.stringify(payload)));
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', await chaveHmac(), utf8Encode(corpo)));
  return `${corpo}.${base64UrlEncode(assinatura)}`;
}

/** Valida assinatura e expiração; devolve o payload. Lança 400 se inválido. */
export async function verificarState(state: string | null | undefined): Promise<StatePayload> {
  const ruim = (msg: string) => new HttpError(msg, 400);
  const [corpo, assinatura] = String(state || '').split('.');
  if (!corpo || !assinatura) throw ruim('state ausente ou malformado');

  const esperada = new Uint8Array(await crypto.subtle.sign('HMAC', await chaveHmac(), utf8Encode(corpo)));
  let recebida: Uint8Array;
  try { recebida = base64UrlDecode(assinatura); } catch { throw ruim('state com assinatura ilegível'); }
  if (!timingSafeEqual(recebida, esperada)) throw ruim('state com assinatura inválida');

  let payload: StatePayload;
  try { payload = JSON.parse(utf8Decode(base64UrlDecode(corpo))); }
  catch { throw ruim('state ilegível'); }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw ruim('state expirado — refaça a conexão');
  }
  if (!payload.user_id || !payload.tenant_id) throw ruim('state incompleto');
  return payload;
}

/** SHA-256 em hex — usado pelo hermes-mcp para casar a API key com key_hash. */
export async function sha256Hex(input: string): Promise<string> {
  return hexEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8Encode(input))));
}
