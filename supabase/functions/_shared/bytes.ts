/**
 * Utilidades de bytes/base64 para o runtime Deno (sem `Buffer`).
 *
 * As functions node usavam `Buffer.from(..., 'base64')` e `'base64url'`. No Deno
 * o equivalente é `atob`/`btoa` sobre strings binárias — que estouram a pilha em
 * strings grandes se feitos com spread. Estas funções fazem a conversão em
 * blocos, o que importa para áudio/imagem de WhatsApp (centenas de KB).
 */

const CHUNK = 0x8000;

/** Uint8Array -> base64 padrão. */
export function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/** base64 padrão -> Uint8Array. Tolera espaços/quebras de linha. */
export function base64Decode(b64: string): Uint8Array {
  const limpo = String(b64 || '').replace(/[\s]/g, '');
  const bin = atob(limpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array -> base64url (sem padding), formato usado no `state` do OAuth. */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url -> Uint8Array. Repõe o padding que o formato omite. */
export function base64UrlDecode(s: string): Uint8Array {
  let b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return base64Decode(b64);
}

export const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);
export const utf8Decode = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Comparação em tempo constante (assinaturas HMAC). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Monta uma data URL (`data:<mime>;base64,...`) — imagem para o modelo de visão. */
export const bytesParaDataUrl = (bytes: Uint8Array, mime: string): string => `data:${mime};base64,${base64Encode(bytes)}`;
