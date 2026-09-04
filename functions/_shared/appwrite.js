/**
 * Cliente Appwrite server-side para as Functions — zero dependências.
 * Usa fetch nativo (Node >= 18) contra a API REST.
 *
 * Env esperadas (o Appwrite injeta as duas primeiras automaticamente):
 *   APPWRITE_FUNCTION_API_ENDPOINT
 *   APPWRITE_FUNCTION_PROJECT_ID
 *   APPWRITE_API_KEY   (crie uma key com escopo de databases/storage/users)
 */
const ENDPOINT = (process.env.APPWRITE_FUNCTION_API_ENDPOINT || process.env.APPWRITE_ENDPOINT || '').replace(/\/+$/, '');
const PROJECT = process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || '';
const API_KEY = process.env.APPWRITE_API_KEY || '';
export const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || 'eisenflow';

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': PROJECT,
      'X-Appwrite-Response-Format': '1.7.0',
      ...(API_KEY ? { 'X-Appwrite-Key': API_KEY } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
  if (!res.ok) {
    const e = new Error(data.message || `HTTP ${res.status}`);
    e.status = res.status; e.type = data.type;
    throw e;
  }
  return data;
}

// ------------------------------------------------------------------ queries
/**
 * Espelham a Query do SDK, produzindo EXATAMENTE o que ele produz: JSON.
 *
 * A versão anterior emitia a sintaxe antiga em string (`equal("a", ["x"])`,
 * `limit(5)`). O Appwrite 1.7 só aceita o formato JSON
 * (`{"method":"equal","attribute":"a","values":["x"]}`) e responde
 * "Invalid query: Syntax error" a qualquer outra coisa — era isso que derrubava
 * TODA function que consultava o banco, a começar pelo whatsapp-connect.
 * migrate.mjs e verify.mjs já usavam o formato novo; este arquivo não.
 *
 * Cada método devolve a string JSON (como o SDK), para continuar sendo
 * concatenável em `queries[]=`. `or`/`and` recebem essas strings e as
 * reidratam, porque no JSON os filhos são objetos, não strings.
 */
const lista = (v) => (Array.isArray(v) ? v : [v]);
const q = (method, attribute, values) =>
  JSON.stringify({ method, ...(attribute !== undefined ? { attribute } : {}), ...(values !== undefined ? { values } : {}) });
const filhos = (qs) => qs.map((s) => (typeof s === 'string' ? JSON.parse(s) : s));

export const Query = {
  equal: (a, v) => q('equal', a, lista(v)),
  notEqual: (a, v) => q('notEqual', a, lista(v)),
  lessThan: (a, v) => q('lessThan', a, lista(v)),
  lessThanEqual: (a, v) => q('lessThanEqual', a, lista(v)),
  greaterThan: (a, v) => q('greaterThan', a, lista(v)),
  greaterThanEqual: (a, v) => q('greaterThanEqual', a, lista(v)),
  between: (a, ini, fim) => q('between', a, [ini, fim]),
  isNull: (a) => q('isNull', a),
  isNotNull: (a) => q('isNotNull', a),
  startsWith: (a, v) => q('startsWith', a, [v]),
  contains: (a, v) => q('contains', a, lista(v)),
  search: (a, v) => q('search', a, [v]),
  select: (attrs) => q('select', undefined, lista(attrs)),
  orderAsc: (a) => q('orderAsc', a),
  orderDesc: (a) => q('orderDesc', a),
  limit: (n) => q('limit', undefined, [n]),
  offset: (n) => q('offset', undefined, [n]),
  cursorAfter: (id) => q('cursorAfter', undefined, [id]),
  cursorBefore: (id) => q('cursorBefore', undefined, [id]),
  or: (qs) => q('or', undefined, filhos(qs)),
  and: (qs) => q('and', undefined, filhos(qs)),
};

const qs = (queries) => (queries?.length ? '?' + queries.map((q) => `queries[]=${encodeURIComponent(q)}`).join('&') : '');

// ---------------------------------------------------------------- databases
export const db = {
  list: (collection, queries = []) =>
    call('GET', `/databases/${DATABASE_ID}/collections/${collection}/documents${qs(queries)}`),

  async findOne(collection, queries = []) {
    const r = await this.list(collection, [...queries, Query.limit(1)]);
    return r.documents?.[0] ?? null;
  },

  /** Pagina com cursor além do teto de 100 por request. */
  async listAll(collection, queries = [], pageSize = 100, hardLimit = 10000) {
    const out = []; let cursor = null;
    while (out.length < hardLimit) {
      const q = [...queries, Query.limit(pageSize)];
      if (cursor) q.push(Query.cursorAfter(cursor));
      const page = await this.list(collection, q);
      out.push(...(page.documents || []));
      if (!page.documents || page.documents.length < pageSize) break;
      cursor = page.documents[page.documents.length - 1].$id;
    }
    return out;
  },

  get: (collection, id) => call('GET', `/databases/${DATABASE_ID}/collections/${collection}/documents/${id}`),

  create: (collection, data, permissions, documentId = 'unique()') =>
    call('POST', `/databases/${DATABASE_ID}/collections/${collection}/documents`, {
      documentId, data: stamp(data), ...(permissions ? { permissions } : {}),
    }),

  update: (collection, id, data, permissions) =>
    call('PATCH', `/databases/${DATABASE_ID}/collections/${collection}/documents/${id}`, {
      data: stamp(data, true), ...(permissions ? { permissions } : {}),
    }),

  delete: (collection, id) =>
    call('DELETE', `/databases/${DATABASE_ID}/collections/${collection}/documents/${id}`),

  /**
   * Substitui os joins do PostgREST: carrega os relacionados em lote.
   * loadRelated('projects', tasks.map(t => t.project_id)) -> Map<id, doc>
   */
  async loadRelated(collection, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map();
    for (let i = 0; i < unique.length; i += 100) {
      const page = await this.list(collection, [Query.equal('$id', unique.slice(i, i + 100)), Query.limit(100)]);
      (page.documents || []).forEach((d) => map.set(d.$id, d));
    }
    return map;
  },
};

function stamp(data, isUpdate = false) {
  const out = { ...data };
  const now = new Date().toISOString();
  if (!isUpdate && out.created_at === undefined) out.created_at = now;
  if (out.updated_at === undefined) out.updated_at = now;
  return out;
}

// ------------------------------------------------------------------ storage
export const storage = {
  getFile: (bucketId, fileId) => call('GET', `/storage/buckets/${bucketId}/files/${fileId}`),
  async download(bucketId, fileId) {
    const res = await fetch(`${ENDPOINT}/storage/buckets/${bucketId}/files/${fileId}/download`, {
      headers: { 'X-Appwrite-Project': PROJECT, 'X-Appwrite-Key': API_KEY },
    });
    if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  /** Base64 para mandar imagem a um modelo multimodal. */
  async asDataUrl(bucketId, fileId, mimeType = 'image/png') {
    const buf = await this.download(bucketId, fileId);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  },
};

// -------------------------------------------------------------------- users
export const users = {
  get: (userId) => call('GET', `/users/${userId}`),
  listByEmail: (email) => call('GET', `/users?${`queries[]=${encodeURIComponent(Query.equal('email', email))}`}`),
};

// -------------------------------------------------------------------- teams
export const teams = {
  get: (teamId) => call('GET', `/teams/${teamId}`),
  /** Só a API key cria Team — é por isso que tenant nasce numa Function, não no front. */
  create: (teamId, name, roles = ['owner', 'admin', 'member', 'guest']) =>
    call('POST', '/teams', { teamId, name, roles }),
  delete: (teamId) => call('DELETE', `/teams/${teamId}`),
  memberships: (teamId) => call('GET', `/teams/${teamId}/memberships`),
  /**
   * Com API key e `userId`, a adesão é imediata — sem e-mail de convite.
   * `url` só é exigido no fluxo por e-mail, que não usamos aqui.
   */
  createMembership: (teamId, body) => call('POST', `/teams/${teamId}/memberships`, body),
};

export { call as rawCall, ENDPOINT, PROJECT };
