#!/usr/bin/env node
/**
 * EisenFlow — migração de schema para Appwrite self-hosted.
 *
 * ZERO DEPENDÊNCIAS: usa só o fetch nativo do Node >= 18 e a API REST do Appwrite.
 * Não precisa de `npm install`. Idempotente: pode rodar quantas vezes quiser.
 *
 *   export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
 *   export APPWRITE_PROJECT_ID="default-6a987e930039a4a13bea"
 *   export APPWRITE_API_KEY="cole_sua_key_aqui"
 *   node appwrite/migrate.mjs                 # cria só o core (34 collections)
 *   node appwrite/migrate.mjs --extras        # core + 7 collections de segurança
 *   node appwrite/migrate.mjs --dry-run       # mostra o plano sem tocar no servidor
 *   node appwrite/migrate.mjs --only=tasks    # uma collection só
 *   node appwrite/migrate.mjs --no-buckets    # pula o Storage
 */

import { COLLECTIONS, BUCKETS, DATABASE_ID, DATABASE_NAME } from './schema.mjs';

// ------------------------------------------------------------------ config
const ENDPOINT = (process.env.APPWRITE_ENDPOINT || '').replace(/\/+$/, '');
const PROJECT = process.env.APPWRITE_PROJECT_ID || '';
const API_KEY = process.env.APPWRITE_API_KEY || '';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => (args.find((a) => a.startsWith(f + '=')) || '').split('=')[1] || null;

const DRY = has('--dry-run');
const WITH_EXTRAS = has('--extras');
const NO_BUCKETS = has('--no-buckets');
const ONLY = val('--only');

if (!DRY && (!ENDPOINT || !PROJECT || !API_KEY)) {
  console.error('\n  Faltam variáveis de ambiente.\n');
  console.error('    export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"');
  console.error('    export APPWRITE_PROJECT_ID="seu-project-id"');
  console.error('    export APPWRITE_API_KEY="sua-api-key"\n');
  process.exit(1);
}

// ------------------------------------------------------------------ saída
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`);
const skip = (m) => console.log(`  ${C.d}·${C.x} ${C.d}${m}${C.x}`);
const warn = (m) => console.log(`  ${C.y}!${C.x} ${m}`);
const fail = (m) => console.log(`  ${C.r}✗${C.x} ${m}`);
const head = (m) => console.log(`\n${C.b}${m}${C.x}`);

const stats = { created: 0, existed: 0, failed: 0, errors: [] };

// ------------------------------------------------------------------ HTTP
async function api(method, path, body) {
  if (DRY) return { __dry: true };
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': PROJECT,
      'X-Appwrite-Key': API_KEY,
      'X-Appwrite-Response-Format': '1.7.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.type = data.type;
    throw err;
  }
  return data;
}

const ALREADY = (e) => e.status === 409;

async function ensure(label, fn) {
  if (DRY) { skip(`[dry] ${label}`); return 'dry'; }
  try {
    await fn();
    ok(label);
    stats.created++;
    return 'created';
  } catch (e) {
    if (ALREADY(e)) { skip(`${label} — já existe`); stats.existed++; return 'existed'; }
    fail(`${label} — ${e.message}`);
    stats.failed++;
    stats.errors.push(`${label}: ${e.message}`);
    return 'failed';
  }
}

// ------------------------------------------------------------------ permissões
// Traduz o modelo de RLS do Postgres para o modelo do Appwrite.
//   'user'       -> qualquer autenticado cria; leitura/escrita por documento
//   'server-doc' -> só a API key cria; o servidor concede permissão por documento
//   'server'     -> ninguém além da API key enxerga
function collectionPermissions(access) {
  switch (access) {
    case 'user': return ['create("users")'];
    case 'server-doc': return [];
    case 'server': return [];
    default: return [];
  }
}
const documentSecurity = (access) => access !== 'server';

function bucketPermissions(access) {
  return access === 'public-read'
    ? ['read("any")', 'create("users")']
    : ['create("users")'];
}

// ------------------------------------------------------------------ atributos
function attrRequest(col, a) {
  const base = `/databases/${DATABASE_ID}/collections/${col}/attributes`;
  const arr = a.array === true;
  // Regra do Appwrite: array não aceita default e não pode ser required.
  const def = arr ? null : (a.default === undefined ? null : a.default);
  const req = arr ? false : !!a.required;

  switch (a.type) {
    case 'string':
      return [`${base}/string`, { key: a.key, size: a.size, required: req, default: req ? null : def, array: arr }];
    case 'integer':
      return [`${base}/integer`, {
        key: a.key, required: req,
        min: a.min ?? -2147483647, max: a.max ?? 2147483647,
        default: req ? null : def, array: arr,
      }];
    case 'boolean':
      return [`${base}/boolean`, { key: a.key, required: req, default: req ? null : def, array: arr }];
    case 'datetime':
      return [`${base}/datetime`, { key: a.key, required: req, default: req ? null : def, array: arr }];
    case 'enum':
      return [`${base}/enum`, { key: a.key, elements: a.elements, required: req, default: req ? null : def, array: arr }];
    default:
      throw new Error(`tipo desconhecido: ${a.type}`);
  }
}

/**
 * Query no formato do Appwrite 1.7: JSON, não o formato string antigo.
 * O servidor 1.7.4 rejeita `limit(500)` com "Invalid query: Syntax error".
 */
const q = (method, values) => `queries[]=${encodeURIComponent(JSON.stringify({ method, values }))}`;

// Índices só podem ser criados depois que os atributos ficam 'available'.
async function waitAttributes(colId, keys, timeoutMs = 120000) {
  if (DRY) return true;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const list = await api('GET', `/databases/${DATABASE_ID}/collections/${colId}/attributes?${q('limit', [500])}`);
    const byKey = new Map((list.attributes || []).map((a) => [a.key, a.status]));
    const pending = keys.filter((k) => byKey.get(k) !== 'available');
    if (pending.length === 0) return true;
    const broken = keys.filter((k) => byKey.get(k) === 'failed');
    if (broken.length) { warn(`atributos com falha em ${colId}: ${broken.join(', ')}`); return false; }
    await new Promise((r) => setTimeout(r, 1200));
  }
  warn(`timeout esperando atributos de ${colId}`);
  return false;
}

// ------------------------------------------------------------------ execução
async function run() {
  const selected = COLLECTIONS.filter((c) => {
    if (ONLY) return c.id === ONLY;
    return WITH_EXTRAS ? true : c.group === 'core';
  });

  console.log(`\n${C.b}EisenFlow → Appwrite${C.x}`);
  console.log(`${C.d}  endpoint  ${ENDPOINT || '(dry-run)'}`);
  console.log(`  projeto   ${PROJECT || '(dry-run)'}`);
  console.log(`  database  ${DATABASE_ID}`);
  console.log(`  escopo    ${selected.length} collections${WITH_EXTRAS ? ' (core + extras)' : ' (core)'}${ONLY ? ` [só ${ONLY}]` : ''}`);
  console.log(`  storage   ${NO_BUCKETS ? 'pulado' : `${BUCKETS.length} buckets`}${C.x}`);

  if (selected.length === 0) { fail(`nenhuma collection casa com --only=${ONLY}`); process.exit(1); }

  head('1. Database');
  await ensure(`database "${DATABASE_ID}"`, () =>
    api('POST', '/databases', { databaseId: DATABASE_ID, name: DATABASE_NAME, enabled: true }));

  head(`2. Collections (${selected.length})`);
  for (const col of selected) {
    console.log(`\n  ${C.b}${col.id}${C.x} ${C.d}${col.note || ''}${C.x}`);
    const r = await ensure(`  collection (${col.access})`, () =>
      api('POST', `/databases/${DATABASE_ID}/collections`, {
        collectionId: col.id,
        name: col.name,
        permissions: collectionPermissions(col.access),
        documentSecurity: documentSecurity(col.access),
        enabled: true,
      }));
    if (r === 'failed') continue;

    for (const a of col.attributes) {
      const [path, body] = attrRequest(col.id, a);
      await ensure(`  attr ${a.key}${a.array ? '[]' : ''} :${a.type}`, () => api('POST', path, body));
      if (!DRY) await new Promise((r) => setTimeout(r, 120)); // evita rate limit do servidor
    }

    if (col.indexes?.length) {
      const keys = [...new Set(col.indexes.flatMap((i) => i.attributes))];
      const ready = await waitAttributes(col.id, keys);
      if (!ready) { warn(`  índices de ${col.id} pulados (atributos não ficaram prontos)`); continue; }
      for (const ix of col.indexes) {
        await ensure(`  index ${ix.key} (${ix.type})`, () =>
          api('POST', `/databases/${DATABASE_ID}/collections/${col.id}/indexes`, {
            key: ix.key,
            type: ix.type,
            attributes: ix.attributes,
            orders: ix.orders || ix.attributes.map(() => 'ASC'),
          }));
        if (!DRY) await new Promise((r) => setTimeout(r, 120));
      }
    }
  }

  if (!NO_BUCKETS && !ONLY) {
    head(`3. Storage (${BUCKETS.length} buckets)`);
    for (const b of BUCKETS) {
      await ensure(`bucket ${b.id}`, () =>
        api('POST', '/storage/buckets', {
          bucketId: b.id,
          name: b.name,
          permissions: bucketPermissions(b.access),
          fileSecurity: b.fileSecurity,
          enabled: true,
          maximumFileSize: b.maximumFileSize,
          allowedFileExtensions: b.allowedFileExtensions,
          compression: 'gzip',
          encryption: b.encryption,
          antivirus: b.antivirus,
        }));
    }
  }

  head('Resumo');
  console.log(`  criados: ${C.g}${stats.created}${C.x}   já existiam: ${C.d}${stats.existed}${C.x}   falhas: ${stats.failed ? C.r : C.d}${stats.failed}${C.x}`);
  if (stats.errors.length) {
    console.log(`\n${C.r}  Erros:${C.x}`);
    stats.errors.slice(0, 30).forEach((e) => console.log(`    - ${e}`));
    if (stats.errors.length > 30) console.log(`    ... e mais ${stats.errors.length - 30}`);
  }
  console.log(`\n  Próximo passo: ${C.b}node appwrite/verify.mjs${WITH_EXTRAS ? ' --extras' : ''}${C.x}\n`);
  process.exit(stats.failed ? 1 : 0);
}

run().catch((e) => { fail(e.message); console.error(e); process.exit(1); });
