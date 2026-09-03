#!/usr/bin/env node
/**
 * Gera src/integrations/appwrite/types.ts a partir de appwrite/schema.mjs.
 * Rode sempre que mexer no schema:  node appwrite/gen-types.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, ENUMS, DATABASE_ID, BUCKETS } from './schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src/integrations/appwrite/types.ts');

const pascal = (s) => s.split(/[_-]/).map((p) => p[0].toUpperCase() + p.slice(1)).join('');

const tsType = (a) => {
  let t;
  if (a.type === 'enum') t = a.elements.map((e) => `'${e}'`).join(' | ');
  else if (a.type === 'integer') t = 'number';
  else if (a.type === 'boolean') t = 'boolean';
  else t = 'string'; // string e datetime (ISO 8601)
  if (a.array) t = a.type === 'enum' ? `(${t})[]` : `${t}[]`;
  return t;
};

const L = [];
L.push('// ============================================================================');
L.push('// GERADO AUTOMATICAMENTE por appwrite/gen-types.mjs — não edite à mão.');
L.push('// Fonte da verdade: appwrite/schema.mjs');
L.push('// ============================================================================');
L.push('');
L.push("import type { Models } from 'appwrite';");
L.push('');
L.push(`export const DATABASE_ID = '${DATABASE_ID}' as const;`);
L.push('');

L.push('/** IDs das collections — use sempre a constante, nunca a string solta. */');
L.push('export const COLLECTIONS = {');
for (const c of COLLECTIONS) L.push(`  ${c.id}: '${c.id}',`);
L.push('} as const;');
L.push('export type CollectionId = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];');
L.push('');

L.push('/** IDs dos buckets do Storage. */');
L.push('export const BUCKETS = {');
for (const b of BUCKETS) L.push(`  '${b.id}': '${b.id}',`);
L.push('} as const;');
L.push('');

L.push('// ---------------------------------------------------------------- enums');
for (const [name, vals] of Object.entries(ENUMS)) {
  L.push(`export type ${pascal(name)} = ${vals.map((v) => `'${v}'`).join(' | ')};`);
  L.push(`export const ${name.toUpperCase()}_VALUES = [${vals.map((v) => `'${v}'`).join(', ')}] as const;`);
}
L.push('');

L.push('// ------------------------------------------------------- documentos');
for (const c of COLLECTIONS) {
  const N = pascal(c.id);
  if (c.note) L.push(`/** ${c.note} */`);
  L.push(`export interface ${N} extends Models.Document {`);
  for (const a of c.attributes) {
    const opt = a.required ? '' : '?';
    const nul = a.required ? '' : ' | null';
    L.push(`  ${a.key}${opt}: ${tsType(a)}${nul};`);
  }
  L.push('}');
  const req = c.attributes.filter((a) => a.required).map((a) => `'${a.key}'`);
  const optKeys = c.attributes.filter((a) => !a.required).map((a) => `'${a.key}'`);
  L.push(`export type ${N}Input = Pick<${N}, ${req.length ? req.join(' | ') : 'never'}>` +
    (optKeys.length ? ` & Partial<Pick<${N}, ${optKeys.join(' | ')}>>;` : ';'));
  L.push('');
}

L.push('/** Mapa collectionId -> tipo do documento, para helpers genéricos. */');
L.push('export interface CollectionTypeMap {');
for (const c of COLLECTIONS) L.push(`  ${c.id}: ${pascal(c.id)};`);
L.push('}');
L.push('');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, L.join('\n'));
console.log(`types.ts gerado: ${L.length} linhas, ${COLLECTIONS.length} interfaces, ${Object.keys(ENUMS).length} enums`);
