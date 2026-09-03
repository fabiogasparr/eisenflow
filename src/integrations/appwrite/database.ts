/**
 * Camada de acesso a dados — equivalente ao `supabase.from(...)`.
 *
 * Mapa de queries:
 *   .eq('a', v)              -> Query.equal('a', v)
 *   .neq / .gt / .gte        -> Query.notEqual / greaterThan / greaterThanEqual
 *   .in('a', [..])           -> Query.equal('a', [..])
 *   .is('a', null)           -> Query.isNull('a')
 *   .order('a', {asc:false}) -> Query.orderDesc('a')
 *   .limit(n) / .range(a,b)  -> Query.limit(n) / Query.offset(a)
 *   .or(...)                 -> Query.or([...])
 *   .ilike('a', '%x%')       -> Query.search('a', 'x')   (exige índice fulltext)
 *   select com join embutido -> NÃO EXISTE: use loadRelated() e junte no cliente
 *
 * SOBRE O `id`:
 * No Postgres cada linha tinha uma coluna `id`. No Appwrite o identificador é
 * `$id`. Em vez de reescrever `task.id` em dezenas de componentes, TODA leitura
 * daqui devolve o documento com um campo `id` espelhando `$id`, e toda escrita
 * remove os campos de metadado antes de enviar. O app continua falando `.id`.
 */
import { databases, ID, Query } from './client';
import { DATABASE_ID, COLLECTIONS } from './types';
import type { CollectionTypeMap } from './types';
import type { Models } from 'appwrite';

export { Query, ID };

type Cid = keyof CollectionTypeMap;
type DocData = Record<string, unknown>;

/** Documento do Appwrite acrescido do `id` que o app espera. */
export type Row<T> = T & { id: string };

const nowIso = () => new Date().toISOString();

/** Metadados do Appwrite (e o `id` sintético) nunca são enviados de volta. */
const META = ['id', '$id', '$collectionId', '$databaseId', '$permissions', '$createdAt', '$updatedAt', '$sequence'];

function stripMeta(data: DocData): DocData {
  const out: DocData = {};
  for (const [k, v] of Object.entries(data)) {
    if (!META.includes(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** Equivalente ao DEFAULT now() das colunas created_at/updated_at. */
function withStamps(data: DocData, isUpdate = false): DocData {
  const out = stripMeta(data);
  if (!isUpdate && out.created_at === undefined) out.created_at = nowIso();
  out.updated_at = nowIso();
  return out;
}

/** Acrescenta `id` a um documento devolvido pelo servidor. */
export const toRow = <T extends Models.Document>(doc: T): Row<T> =>
  ({ ...doc, id: doc.$id }) as Row<T>;

const toRows = <T extends Models.Document>(docs: T[]): Row<T>[] => docs.map(toRow);

/**
 * O SDK tipa `data` com um tipo condicional sobre o genérico do documento, que
 * não resolve dentro de um helper genérico. Esta view frouxa dos métodos mantém
 * a tipagem forte na FRONTEIRA (o que o chamador passa e recebe) e afrouxa só a
 * passagem interna. O schema do Appwrite valida no servidor de qualquer forma.
 */
interface LooseDatabases {
  createDocument(db: string, col: string, id: string, data: DocData, permissions?: string[]): Promise<Models.Document>;
  updateDocument(db: string, col: string, id: string, data: DocData, permissions?: string[]): Promise<Models.Document>;
  getDocument(db: string, col: string, id: string): Promise<Models.Document>;
  deleteDocument(db: string, col: string, id: string): Promise<unknown>;
  listDocuments(db: string, col: string, queries?: string[]): Promise<Models.DocumentList<Models.Document>>;
}
const raw = databases as unknown as LooseDatabases;

// ------------------------------------------------------------------ escrita
export async function create<K extends Cid>(
  collection: K,
  data: Partial<CollectionTypeMap[K]>,
  permissions?: string[],
  documentId: string = ID.unique(),
): Promise<Row<CollectionTypeMap[K]>> {
  const doc = await raw.createDocument(
    DATABASE_ID, COLLECTIONS[collection], documentId,
    withStamps(data as DocData), permissions,
  );
  return toRow(doc) as Row<CollectionTypeMap[K]>;
}

export async function update<K extends Cid>(
  collection: K, id: string,
  data: Partial<CollectionTypeMap[K]>,
  permissions?: string[],
): Promise<Row<CollectionTypeMap[K]>> {
  const doc = await raw.updateDocument(
    DATABASE_ID, COLLECTIONS[collection], id,
    withStamps(data as DocData, true), permissions,
  );
  return toRow(doc) as Row<CollectionTypeMap[K]>;
}

export const remove = <K extends Cid>(collection: K, id: string) =>
  raw.deleteDocument(DATABASE_ID, COLLECTIONS[collection], id);

/**
 * Upsert por chave lógica — substitui o `.upsert({ onConflict: 'user_id' })`.
 * Procura pelo filtro, atualiza se achar, cria se não achar.
 */
export async function upsert<K extends Cid>(
  collection: K,
  matchQueries: string[],
  data: Partial<CollectionTypeMap[K]>,
  permissions?: string[],
): Promise<Row<CollectionTypeMap[K]>> {
  const found = await findOne(collection, matchQueries);
  if (found) return update(collection, found.id, data, permissions);
  return create(collection, data, permissions);
}

// ------------------------------------------------------------------ leitura
export async function getById<K extends Cid>(collection: K, id: string) {
  const doc = await raw.getDocument(DATABASE_ID, COLLECTIONS[collection], id);
  return toRow(doc) as Row<CollectionTypeMap[K]>;
}

export async function list<K extends Cid>(
  collection: K, queries: string[] = [],
): Promise<{ total: number; documents: Row<CollectionTypeMap[K]>[] }> {
  const r = await raw.listDocuments(DATABASE_ID, COLLECTIONS[collection], queries);
  return { total: r.total, documents: toRows(r.documents) as Row<CollectionTypeMap[K]>[] };
}

/** Só os documentos — o formato que a maioria dos hooks quer. */
export async function listDocs<K extends Cid>(collection: K, queries: string[] = []) {
  return (await list(collection, queries)).documents;
}

/** Primeiro resultado ou null — equivale ao `.maybeSingle()` do Supabase. */
export async function findOne<K extends Cid>(collection: K, queries: string[] = []) {
  const r = await list(collection, [...queries, Query.limit(1)]);
  return r.documents[0] ?? null;
}

/**
 * Pagina além do teto de 100 documentos por request usando cursor.
 * Use com parcimônia: cada página é um round-trip.
 */
export async function listAll<K extends Cid>(
  collection: K, queries: string[] = [], pageSize = 100, hardLimit = 5000,
): Promise<Row<CollectionTypeMap[K]>[]> {
  const out: Row<CollectionTypeMap[K]>[] = [];
  let cursor: string | null = null;
  while (out.length < hardLimit) {
    const q = [...queries, Query.limit(pageSize)];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const page = await list(collection, q);
    out.push(...page.documents);
    if (page.documents.length < pageSize) break;
    cursor = page.documents[page.documents.length - 1].$id;
  }
  return out;
}

/**
 * Substitui os joins embutidos do PostgREST (ex.: tasks -> projects(name)).
 * Busca os relacionados em UMA query e devolve um Map id -> documento.
 */
export async function loadRelated<K extends Cid>(
  collection: K, ids: Array<string | null | undefined>,
): Promise<Map<string, Row<CollectionTypeMap[K]>>> {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  const map = new Map<string, Row<CollectionTypeMap[K]>>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const page = await list(collection, [Query.equal('$id', chunk), Query.limit(100)]);
    page.documents.forEach((d) => map.set(d.$id, d));
  }
  return map;
}

// -------------------------------------------------------------------- jsonb
/** Campos que eram jsonb viajam como string JSON. */
export const parseJson = <T>(rawValue: string | null | undefined, fallback: T): T => {
  if (!rawValue) return fallback;
  try { return JSON.parse(rawValue) as T; } catch { return fallback; }
};
export const toJson = (v: unknown) => JSON.stringify(v ?? {});
