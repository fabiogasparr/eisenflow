#!/usr/bin/env node
/**
 * Implanta as Appwrite Functions do EisenFlow.
 *
 * ZERO DEPENDÊNCIAS: monta o .tar.gz na mão (zlib nativo) e sobe pela API REST.
 * Não precisa do Appwrite CLI nem de `npm install`.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * O Appwrite empacota apenas a pasta da própria function. Como todas importam
 * de `functions/_shared/`, um `tar` ingênuo da pasta deixaria o código
 * compartilhado de fora e a function quebraria em execução com "module not
 * found". Aqui, `_shared` é copiado para dentro de cada pacote e os imports
 * `../_shared/x.js` são reescritos para `./shared/x.js`.
 *
 * ONDE RODAR
 * Na SUA máquina (Terminal do macOS) ou no servidor — em qualquer lugar que
 * enxergue appwrite.kz3solucoes.cloud.
 *
 *   export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
 *   export APPWRITE_PROJECT_ID="6a987e930039a4a13bea"
 *   export APPWRITE_API_KEY="cole_sua_key_aqui"
 *   node appwrite/deploy-functions.mjs              # só as prontas
 *   node appwrite/deploy-functions.mjs --all        # inclui os esqueletos
 *   node appwrite/deploy-functions.mjs --only=classify-task
 *   node appwrite/deploy-functions.mjs --dry-run
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS } from './gen-functions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = (process.env.APPWRITE_ENDPOINT || '').replace(/\/+$/, '');
const PROJECT = process.env.APPWRITE_PROJECT_ID || '';
const API_KEY = process.env.APPWRITE_API_KEY || '';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;

/**
 * Funções cuja lógica foi realmente portada. As demais são esqueletos: se
 * implantadas, respondem 200 com `ported:false`, e o app trataria isso como
 * sucesso — pior do que o erro honesto de "ainda não implantada". Por isso
 * ficam de fora salvo `--all` explícito.
 */
const PRONTAS = new Set(['classify-task', 'whatsapp-send', 'cleanup-reminders']);

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`);
const warn = (m) => console.log(`  ${C.y}!${C.x} ${m}`);
const fail = (m) => console.log(`  ${C.r}✗${C.x} ${m}`);

if (!DRY && (!ENDPOINT || !PROJECT || !API_KEY)) {
  console.error(`\n  Faltam variáveis de ambiente.\n
    export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
    export APPWRITE_PROJECT_ID="6a987e930039a4a13bea"
    export APPWRITE_API_KEY="..."\n`);
  process.exit(1);
}

// ------------------------------------------------------------------ tar
/** Cabeçalho USTAR de 512 bytes. */
function tarHeader(nome, tamanho, modo = 0o644) {
  const h = Buffer.alloc(512);
  const put = (str, off, len) => h.write(str.slice(0, len - 1), off, len - 1, 'utf8');
  const oct = (n, off, len) => h.write(n.toString(8).padStart(len - 1, '0') + '\0', off, len, 'utf8');

  if (Buffer.byteLength(nome) > 99) throw new Error(`caminho longo demais para o tar: ${nome}`);
  put(nome, 0, 100);
  oct(modo, 100, 8);
  oct(0, 108, 8);            // uid
  oct(0, 116, 8);            // gid
  oct(tamanho, 124, 12);
  oct(Math.floor(Date.now() / 1000), 136, 12);
  h.write('        ', 148, 8, 'utf8');  // checksum em branco durante o cálculo
  h.write('0', 156, 1, 'utf8');         // tipo: arquivo comum
  put('ustar', 257, 6);
  h.write('00', 263, 2, 'utf8');

  let soma = 0;
  for (const b of h) soma += b;
  h.write(soma.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return h;
}

const pad512 = (n) => (n % 512 === 0 ? 0 : 512 - (n % 512));

function montarTarGz(arquivos) {
  const partes = [];
  for (const { nome, conteudo } of arquivos) {
    const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
    partes.push(tarHeader(nome, buf.length), buf, Buffer.alloc(pad512(buf.length)));
  }
  partes.push(Buffer.alloc(1024)); // fim do arquivo tar
  return gzipSync(Buffer.concat(partes), { level: 9 });
}

// --------------------------------------------------- montagem do pacote
function listarArquivos(dir, base = dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const cheio = join(dir, nome);
    if (statSync(cheio).isDirectory()) saida.push(...listarArquivos(cheio, base));
    else saida.push(relative(base, cheio));
  }
  return saida;
}

/**
 * Monta o conteúdo do pacote de uma function, já com o `_shared` embutido.
 * Retorna a lista {nome, conteudo} pronta para virar tar.
 */
function empacotar(nomeFn) {
  const dir = join(ROOT, 'functions', nomeFn);
  if (!existsSync(dir)) throw new Error(`pasta não encontrada: functions/${nomeFn}`);

  const arquivos = [];
  for (const rel of listarArquivos(dir)) {
    let texto = readFileSync(join(dir, rel), 'utf8');
    // Reescreve o import do código compartilhado para o caminho de dentro do pacote.
    texto = texto.replace(/(['"])\.\.\/_shared\//g, '$1./shared/');
    arquivos.push({ nome: rel.split('\\').join('/'), conteudo: texto });
  }

  const shared = join(ROOT, 'functions', '_shared');
  for (const rel of listarArquivos(shared)) {
    arquivos.push({ nome: `src/shared/${rel}`, conteudo: readFileSync(join(shared, rel), 'utf8') });
  }
  return arquivos;
}

// ------------------------------------------------------------------ API
async function api(method, path, body, extra = {}) {
  const res = await fetch(`${ENDPOINT}${path}`, {
    method,
    headers: {
      'X-Appwrite-Project': PROJECT,
      'X-Appwrite-Key': API_KEY,
      'X-Appwrite-Response-Format': '1.7.0',
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...extra,
    },
    body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body)),
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
  if (!res.ok) { const e = new Error(data.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ------------------------------------------------------------------ run
async function run() {
  const alvo = FUNCTIONS.filter((f) => (ONLY ? f.name === ONLY : (ALL || PRONTAS.has(f.name))));

  console.log(`\n${C.b}Implantando Appwrite Functions${C.x}`);
  console.log(`${C.d}  endpoint ${ENDPOINT || '(dry-run)'}`);
  console.log(`  escopo   ${alvo.length} de ${FUNCTIONS.length}${ALL ? ' (inclui esqueletos)' : ' (só as portadas)'}${C.x}\n`);
  if (!alvo.length) { fail(`nada a implantar${ONLY ? ` para --only=${ONLY}` : ''}`); process.exit(1); }

  let sucesso = 0, erro = 0;
  for (const f of alvo) {
    const esqueleto = !PRONTAS.has(f.name);
    console.log(`${C.b}${f.name}${C.x}${esqueleto ? ` ${C.y}(esqueleto)${C.x}` : ''}`);

    let pacote;
    try {
      pacote = empacotar(f.name);
      const gz = montarTarGz(pacote);
      ok(`pacote montado: ${pacote.length} arquivos, ${(gz.length / 1024).toFixed(1)} KB`);
      if (DRY) { console.log(`  ${C.d}[dry-run] nada enviado${C.x}\n`); continue; }

      // 1. cria a function (409 = já existe, seguimos para o deploy)
      try {
        await api('POST', '/functions', {
          functionId: f.name, name: f.name, runtime: 'node-22',
          execute: f.auth === 'jwt-usuario' ? ['users'] : (f.auth === 'publica' ? ['any'] : []),
          schedule: f.cron || '', timeout: f.complexity === 'alta' ? 300 : 60,
          enabled: true, logging: true, entrypoint: 'src/main.js',
          scopes: ['databases.read', 'documents.read', 'documents.write', 'users.read', 'files.read', 'files.write'],
        });
        ok('function criada');
      } catch (e) {
        if (e.status === 409) ok('function já existia');
        else throw e;
      }

      // 2. envia o código e ativa
      const fd = new FormData();
      fd.append('code', new Blob([gz], { type: 'application/gzip' }), 'code.tar.gz');
      fd.append('activate', 'true');
      fd.append('entrypoint', 'src/main.js');
      const dep = await api('POST', `/functions/${f.name}/deployments`, fd);
      ok(`deployment ${dep.$id} enviado (status: ${dep.status})`);
      sucesso++;
    } catch (e) {
      fail(e.message);
      erro++;
    }
    console.log('');
  }

  console.log(`${C.b}Resumo${C.x}`);
  console.log(`  implantadas: ${C.g}${sucesso}${C.x}   falhas: ${erro ? C.r : C.d}${erro}${C.x}`);
  if (sucesso) {
    console.log(`\n  ${C.y}Não esqueça:${C.x} cadastre as variáveis de cada function no console`);
    console.log(`  (Functions → <nome> → Settings → Variables). Sem AI_API_KEY a`);
    console.log(`  classify-task sobe, mas responde erro na primeira chamada.\n`);
  }
  process.exit(erro ? 1 : 0);
}

run().catch((e) => { fail(e.message); console.error(e); process.exit(1); });
