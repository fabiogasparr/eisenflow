#!/usr/bin/env node
/**
 * Cadastra as variáveis de ambiente das Appwrite Functions.
 *
 * ZERO DEPENDÊNCIAS. Idempotente: atualiza a variável se já existir, cria se não.
 *
 * POR QUE ESTE SCRIPT EXISTE
 * São 20 functions e 11 variáveis, distribuídas de forma desigual — cadastrar à
 * mão no console é 60+ campos e um erro de digitação silencioso. Aqui a fonte da
 * verdade é o campo `secrets` de cada function em gen-functions.mjs: cada
 * function recebe exatamente o que declara precisar, e nada além.
 *
 * OS TRÊS SEGREDOS QUE ELE GERA SOZINHO
 * INTERNAL_FUNCTION_SECRET, EVOLUTION_WEBHOOK_SECRET e
 * GOOGLE_TOKENS_ENCRYPTION_KEY não são credenciais de ninguém: são segredos
 * novos, deste projeto. O script os gera com crypto.randomBytes e os grava
 * direto no Appwrite. Ninguém precisa inventá-los, escrevê-los num chat, nem
 * copiá-los entre janelas — o valor nasce e morre dentro desta execução.
 *
 * Rode uma vez com --gerar para criar os três e guardá-los em appwrite/.secrets
 * (arquivo com permissão 600, fora do git). Nas execuções seguintes ele reusa o
 * arquivo, para não invalidar webhooks e tokens já cifrados.
 *
 * ATENÇÃO ao GOOGLE_TOKENS_ENCRYPTION_KEY: trocar essa chave torna ilegíveis os
 * refresh tokens já gravados — todo tenant teria que reconectar o Google.
 *
 * COMO RODAR (no servidor ou na sua máquina, com acesso ao Appwrite)
 *
 *   export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
 *   export APPWRITE_PROJECT_ID="6a987e930039a4a13bea"
 *   export APPWRITE_API_KEY="..."        # key de servidor, escopo functions.write
 *   export APPWRITE_DATABASE_ID="6a9887fe000ab0ab3b2e"
 *   export EVOLUTION_API_URL="https://evo-eisenflow.kz3solucoes.cloud"
 *   export EVOLUTION_API_KEY="..."       # GLOBAL_API_KEY do Evolution GO
 *   export AI_API_KEY="..."              # chave do OmniRoute para o EisenFlow
 *   export GOOGLE_CLIENT_ID="..."
 *   export GOOGLE_CLIENT_SECRET="..."
 *   export PUBLIC_WEBHOOK_BASE_URL="https://<dominio-publico-das-functions>"
 *
 *   node appwrite/configurar-secrets.mjs --gerar     # 1ª vez
 *   node appwrite/configurar-secrets.mjs             # depois
 *   node appwrite/configurar-secrets.mjs --dry-run
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS } from './gen-functions.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ_SEGREDOS = resolve(AQUI, '.secrets');

const ENDPOINT = (process.env.APPWRITE_ENDPOINT || 'https://appwrite.kz3solucoes.cloud/v1').replace(/\/+$/, '');
const PROJECT = process.env.APPWRITE_PROJECT_ID || '';
const API_KEY = process.env.APPWRITE_API_KEY || '';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const GERAR = args.includes('--gerar');

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`);
const aviso = (m) => console.log(`  ${C.y}!${C.x} ${m}`);
const erro = (m) => console.log(`  ${C.r}✗${C.x} ${m}`);

/** Os três que o projeto gera para si mesmo. */
const GERADOS = {
  INTERNAL_FUNCTION_SECRET: () => randomBytes(32).toString('hex'),
  EVOLUTION_WEBHOOK_SECRET: () => randomBytes(24).toString('hex'),
  // 32 bytes: exigência do AES-256-GCM em _shared/cripto.js.
  GOOGLE_TOKENS_ENCRYPTION_KEY: () => randomBytes(32).toString('hex'),
};

function carregarGerados() {
  if (existsSync(ARQ_SEGREDOS)) {
    const guardados = Object.fromEntries(
      readFileSync(ARQ_SEGREDOS, 'utf8')
        .split('\n').filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    const faltando = Object.keys(GERADOS).filter((k) => !guardados[k]);
    if (faltando.length && !GERAR) {
      erro(`${ARQ_SEGREDOS} existe mas não tem ${faltando.join(', ')}. Rode com --gerar.`);
      process.exit(1);
    }
    faltando.forEach((k) => { guardados[k] = GERADOS[k](); });
    if (faltando.length) salvar(guardados);
    return guardados;
  }
  if (!GERAR) {
    erro(`${ARQ_SEGREDOS} não existe. Rode uma vez com --gerar para criar os segredos do projeto.`);
    process.exit(1);
  }
  const novos = Object.fromEntries(Object.entries(GERADOS).map(([k, f]) => [k, f()]));
  salvar(novos);
  ok(`segredos gerados e gravados em ${ARQ_SEGREDOS} (600)`);
  return novos;
}

function salvar(obj) {
  if (DRY) return;
  writeFileSync(ARQ_SEGREDOS, Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  chmodSync(ARQ_SEGREDOS, 0o600);
}

async function api(method, caminho, corpo) {
  const res = await fetch(`${ENDPOINT}${caminho}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': PROJECT,
      'X-Appwrite-Key': API_KEY,
      'X-Appwrite-Response-Format': '1.7.0',
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const txt = await res.text();
  let dados; try { dados = txt ? JSON.parse(txt) : {}; } catch { dados = { message: txt }; }
  if (!res.ok) { const e = new Error(dados.message || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return dados;
}

async function main() {
  if (!PROJECT || !API_KEY) {
    erro('APPWRITE_PROJECT_ID e APPWRITE_API_KEY são obrigatórias');
    process.exit(1);
  }

  const gerados = carregarGerados();

  const valores = {
    ...gerados,
    APPWRITE_API_KEY: API_KEY,
    APPWRITE_DATABASE_ID: process.env.APPWRITE_DATABASE_ID || '6a9887fe000ab0ab3b2e',
    EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || '',
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || '',
    AI_API_KEY: process.env.AI_API_KEY || '',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    PUBLIC_WEBHOOK_BASE_URL: process.env.PUBLIC_WEBHOOK_BASE_URL || '',
  };

  // Toda function precisa das duas do Appwrite: o _shared/appwrite.js usa as duas
  // para falar com o banco em nome do servidor.
  const SEMPRE = ['APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];

  const faltando = [...new Set(FUNCTIONS.flatMap((f) => f.secrets))]
    .filter((k) => !(k in GERADOS) && !valores[k]);
  if (faltando.length) {
    aviso(`sem valor (serão puladas): ${faltando.join(', ')}`);
  }

  let criadas = 0, atualizadas = 0;
  for (const f of FUNCTIONS) {
    const querendo = [...new Set([...SEMPRE, ...f.secrets])].filter((k) => valores[k]);
    let existentes;
    try {
      existentes = (await api('GET', `/functions/${f.name}/variables`)).variables || [];
    } catch (e) {
      if (e.status === 404) { aviso(`${f.name}: ainda não implantada, pulando`); continue; }
      throw e;
    }
    const porNome = new Map(existentes.map((v) => [v.key, v]));

    for (const chave of querendo) {
      const valor = valores[chave];
      const atual = porNome.get(chave);
      if (DRY) { console.log(`  ${C.d}[dry]${C.x} ${f.name}.${chave}`); continue; }
      if (atual) {
        await api('PUT', `/functions/${f.name}/variables/${atual.$id}`, { key: chave, value: valor, secret: true });
        atualizadas++;
      } else {
        await api('POST', `/functions/${f.name}/variables`, { key: chave, value: valor, secret: true });
        criadas++;
      }
    }
    ok(`${f.name}: ${querendo.length} variáveis`);
  }

  console.log(`\n${criadas} criadas, ${atualizadas} atualizadas.`);
  if (valores.EVOLUTION_WEBHOOK_SECRET && valores.PUBLIC_WEBHOOK_BASE_URL) {
    console.log(`\nURL do webhook que o whatsapp-connect vai registrar na Evolution GO:`);
    console.log(`  ${valores.PUBLIC_WEBHOOK_BASE_URL.replace(/\/+$/, '')}/whatsapp-webhook?secret=<EVOLUTION_WEBHOOK_SECRET>`);
    console.log(`  ${C.d}(o segredo não é impresso; está em ${ARQ_SEGREDOS})${C.x}`);
  }
}

main().catch((e) => { erro(e.message); process.exit(1); });
