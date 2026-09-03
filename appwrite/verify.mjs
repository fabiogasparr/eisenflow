#!/usr/bin/env node
/**
 * EisenFlow — verificação pós-migração.
 * Compara o que existe no Appwrite com o schema declarado e aponta divergências.
 * Zero dependências. Não escreve nada — é só leitura.
 *
 *   node appwrite/verify.mjs [--extras]
 */
import { COLLECTIONS, BUCKETS, DATABASE_ID } from './schema.mjs';

const ENDPOINT = (process.env.APPWRITE_ENDPOINT || '').replace(/\/+$/, '');
const PROJECT = process.env.APPWRITE_PROJECT_ID || '';
const API_KEY = process.env.APPWRITE_API_KEY || '';
const WITH_EXTRAS = process.argv.includes('--extras');

if (!ENDPOINT || !PROJECT || !API_KEY) {
  console.error('Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY.');
  process.exit(1);
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m' };

async function api(path) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    headers: {
      'X-Appwrite-Project': PROJECT,
      'X-Appwrite-Key': API_KEY,
      'X-Appwrite-Response-Format': '1.7.0',
    },
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
  if (!res.ok) { const e = new Error(data.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/**
 * Query no formato do Appwrite 1.7: JSON. O formato string antigo (`limit(500)`)
 * é rejeitado pelo servidor 1.7.4 com "Invalid query: Syntax error".
 */
const q = (method, values) => `queries[]=${encodeURIComponent(JSON.stringify({ method, values }))}`;
const problems = [];
let okCount = 0;

const expected = COLLECTIONS.filter((c) => (WITH_EXTRAS ? true : c.group === 'core'));

console.log(`\n${C.b}Verificando ${expected.length} collections em ${DATABASE_ID}${C.x}\n`);

try { await api(`/databases/${DATABASE_ID}`); }
catch { console.error(`${C.r}Database "${DATABASE_ID}" não existe.${C.x}`); process.exit(1); }

for (const col of expected) {
  let remote;
  try { remote = await api(`/databases/${DATABASE_ID}/collections/${col.id}`); }
  catch { problems.push(`${col.id}: collection AUSENTE`); console.log(`${C.r}✗${C.x} ${col.id} — ausente`); continue; }

  const attrs = await api(`/databases/${DATABASE_ID}/collections/${col.id}/attributes?${q('limit', [500])}`);
  const remoteAttrs = new Map((attrs.attributes || []).map((a) => [a.key, a]));
  const idxs = await api(`/databases/${DATABASE_ID}/collections/${col.id}/indexes?${q('limit', [500])}`);
  const remoteIdx = new Map((idxs.indexes || []).map((i) => [i.key, i]));

  const line = [];
  for (const a of col.attributes) {
    const r = remoteAttrs.get(a.key);
    if (!r) { problems.push(`${col.id}.${a.key}: atributo AUSENTE`); line.push(`${C.r}-${a.key}${C.x}`); continue; }
    if (r.status !== 'available') { problems.push(`${col.id}.${a.key}: status ${r.status}`); line.push(`${C.y}~${a.key}${C.x}`); continue; }
    const wantArray = a.array === true;
    if (!!r.array !== wantArray) problems.push(`${col.id}.${a.key}: array esperado ${wantArray}, veio ${!!r.array}`);
    okCount++;
  }
  for (const ix of col.indexes || []) {
    const r = remoteIdx.get(ix.key);
    if (!r) { problems.push(`${col.id}: índice ${ix.key} AUSENTE`); line.push(`${C.r}-idx:${ix.key}${C.x}`); continue; }
    if (r.status !== 'available') problems.push(`${col.id}: índice ${ix.key} status ${r.status}`);
    if (r.type !== ix.type) problems.push(`${col.id}: índice ${ix.key} tipo ${r.type} != ${ix.type}`);
    okCount++;
  }

  const extraAttrs = [...remoteAttrs.keys()].filter((k) => !col.attributes.some((a) => a.key === k));
  if (extraAttrs.length) line.push(`${C.y}+${extraAttrs.join(',')}${C.x}`);

  const wantDocSec = col.access !== 'server';
  if (remote.documentSecurity !== wantDocSec) problems.push(`${col.id}: documentSecurity ${remote.documentSecurity} != ${wantDocSec}`);

  const mark = line.length ? `${C.y}!${C.x}` : `${C.g}✓${C.x}`;
  console.log(`${mark} ${col.id.padEnd(34)} ${C.d}${col.attributes.length} attrs, ${(col.indexes || []).length} idx${C.x} ${line.join(' ')}`);
}

console.log(`\n${C.b}Storage${C.x}`);
for (const b of BUCKETS) {
  try { await api(`/storage/buckets/${b.id}`); console.log(`${C.g}✓${C.x} ${b.id}`); okCount++; }
  catch { problems.push(`bucket ${b.id}: AUSENTE`); console.log(`${C.r}✗${C.x} ${b.id} — ausente`); }
}

console.log(`\n${C.b}Resultado${C.x}`);
console.log(`  itens conferidos OK: ${C.g}${okCount}${C.x}`);
if (problems.length) {
  console.log(`  problemas: ${C.r}${problems.length}${C.x}\n`);
  problems.forEach((p) => console.log(`    - ${p}`));
  console.log('');
  process.exit(1);
}
console.log(`  ${C.g}Nenhuma divergência. Schema íntegro.${C.x}\n`);
