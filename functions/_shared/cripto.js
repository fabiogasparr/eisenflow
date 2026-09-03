/**
 * Cifragem simétrica dos tokens do Google e assinatura do `state` do OAuth.
 *
 * No Postgres isto era `encrypt_token`/`decrypt_token` (pgcrypto, chamados via
 * RPC pelas Edge Functions). O Appwrite não tem banco com extensões, então a
 * cifra passa a acontecer aqui, em node:crypto — zero dependência nova.
 *
 * Formato do blob: base64( iv[12] || authTag[16] || ciphertext ).
 * Um campo só, para caber no `string(5000)` da collection sem inventar coluna.
 *
 * Env: GOOGLE_TOKENS_ENCRYPTION_KEY — a mesma chave serve para a cifra e para o
 * HMAC do state. É segredo de servidor; nunca chega ao navegador.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const IV_BYTES = 12;   // GCM recomenda 96 bits
const TAG_BYTES = 16;

/**
 * A chave configurada é texto livre (o operador cola o que quiser no console).
 * SHA-256 normaliza para os 32 bytes exigidos pelo AES-256 sem exigir formato.
 */
function chave() {
  const bruta = process.env.GOOGLE_TOKENS_ENCRYPTION_KEY;
  if (!bruta) throw new Error('GOOGLE_TOKENS_ENCRYPTION_KEY não configurada');
  return createHash('sha256').update(bruta, 'utf8').digest();
}

/** Cifra um token do Google. Devolve base64(iv+tag+ciphertext). */
export function cifrar(textoPlano) {
  if (textoPlano == null || textoPlano === '') return null;
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const ct = Buffer.concat([c.update(String(textoPlano), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** Decifra o blob gravado por cifrar(). Lança se a chave mudou ou o dado foi adulterado. */
export function decifrar(blob) {
  if (!blob) return null;
  const buf = Buffer.from(String(blob), 'base64');
  if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error('token cifrado inválido');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', chave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ------------------------------------------------------------- state do OAuth
// O original mandava o access_token da sessão do Supabase cru no `state` da URL
// de consentimento. Isso é (a) vazamento de credencial em URL e (b) CSRF: nada
// impedia um terceiro de forjar o state e amarrar a SUA conta Google à conta
// dele. Aqui o state é um payload assinado com HMAC-SHA256 e com validade.

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** @param {{user_id:string, tenant_id:string}} dados */
export function assinarState(dados, validadeSegundos = 600) {
  const payload = {
    ...dados,
    nonce: randomBytes(16).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + validadeSegundos,
  };
  const corpo = b64url(JSON.stringify(payload));
  const assinatura = createHmac('sha256', chave()).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}

/** Valida assinatura e expiração; devolve o payload. Lança com status 400 se inválido. */
export function verificarState(state) {
  const ruim = (msg) => { const e = new Error(msg); e.status = 400; return e; };
  const [corpo, assinatura] = String(state || '').split('.');
  if (!corpo || !assinatura) throw ruim('state ausente ou malformado');

  const esperada = createHmac('sha256', chave()).update(corpo).digest('base64url');
  const a = Buffer.from(assinatura); const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw ruim('state com assinatura inválida');

  let payload;
  try { payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')); }
  catch { throw ruim('state ilegível'); }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw ruim('state expirado — refaça a conexão');
  }
  if (!payload.user_id || !payload.tenant_id) throw ruim('state incompleto');
  return payload;
}
