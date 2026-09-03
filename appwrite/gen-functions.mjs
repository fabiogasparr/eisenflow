#!/usr/bin/env node
/**
 * Gera os esqueletos das 20 Appwrite Functions + appwrite.json,
 * a partir do inventário das Supabase Edge Functions originais.
 *
 *   node appwrite/gen-functions.mjs
 *
 * IMPORTANTE: os esqueletos trazem o CONTRATO exato (entrada, saída, secrets,
 * collections tocadas, armadilhas do porte) e o scaffold já ligado (auth, db,
 * evolution, ia). A LÓGICA DE NEGÓCIO de cada função continua no arquivo Deno
 * original e precisa ser transposta — o bloco `PORTAR` marca onde.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Runtime das functions. O servidor 1.7.4 do projeto só tem `node-20.0`
 * instalado — pedir `node-22` devolve "Runtime is not supported". Confirme com
 * GET /v1/functions/runtimes antes de trocar.
 */
const RUNTIME = process.env.APPWRITE_RUNTIME || 'node-20.0';

export const FUNCTIONS = [
  { name:'ai-task-chat', purpose:'Chat de IA que cria tarefas estruturadas ou responde em linguagem natural, com texto e imagens', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['AI_API_KEY'], tables_read:[], tables_write:[], external:['IA'], input:'{ messages[], context?: {teamMembers[], projects[]}, images?: string[] }', output:"{ type:'tasks', tasks[], summary } | { type:'chat', message }", complexity:'media', notes:'Era público no Supabase — aqui passa a exigir sessão. Lovable AI Gateway -> OmniRoute via _shared/ai.js.' },
  { name:'analyze-task-image', purpose:'OCR, descrição visual e sugestão de subtarefas sobre imagem anexada a uma tarefa', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['AI_API_KEY'], tables_read:['task_attachments','tasks','tenant_members'], tables_write:['task_attachments'], external:['IA'], input:'{ attachment_id, task_title?, task_description? }', output:'{ ocr_text, description, suggested_subtasks[] }', complexity:'alta', notes:'createSignedUrl do Supabase Storage -> storage.asDataUrl() do _shared/appwrite.js.' },
  { name:'classify-task', purpose:'Classifica a tarefa em quadrante da Matriz de Eisenhower com urgência e importância', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['AI_API_KEY'], tables_read:[], tables_write:[], external:['IA'], input:'{ title, description }', output:'{ quadrant, urgency, importance }', complexity:'baixa', notes:'Sem banco nem storage. Porte mais simples do lote.' },
  { name:'cleanup-reminders', purpose:'Apaga lembretes já finalizados com mais de 7 dias', trigger:'cron', cron:'0 3 * * *', auth:'servidor', secrets:[], tables_read:['scheduled_reminders'], tables_write:['scheduled_reminders'], external:[], input:'nenhum', output:'{ ok:true, deleted }', complexity:'baixa', notes:'Appwrite não tem DELETE em lote por filtro: liste com cursor e apague em loop.' },
  { name:'dispatch-reminders', purpose:'Drena a fila de lembretes pendentes e entrega por canal (in_app, browser, whatsapp pessoal/tenant, email)', trigger:'cron', cron:'*/5 * * * *', auth:'servidor', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY'], tables_read:['scheduled_reminders','whatsapp_connections','tenant_whatsapp_connections','tenant_member_phones'], tables_write:['scheduled_reminders','notifications'], external:['Evolution API'], input:'nenhum', output:'{ ok, processed, sent, failed }', complexity:'media', notes:'Coração do sistema de lembretes. Manter o contador de attempts e o last_error.' },
  { name:'generate-recurring-tasks', purpose:'Cria a próxima instância de tarefas recorrentes concluídas ou eliminadas', trigger:'cron', cron:'0 4 * * *', auth:'servidor', secrets:[], tables_read:['tasks'], tables_write:['tasks'], external:[], input:'nenhum', output:'{ created }', complexity:'baixa', notes:'A nova tarefa precisa copiar as PERMISSÕES do documento pai (taskPermissions).' },
  // auth:'publica' (execute:['any']) NÃO é descuido: o Google redireciona o
  // NAVEGADOR para ?action=callback, sem nenhuma sessão do Appwrite no request.
  // Quem autentica esse GET é o `state` assinado com HMAC (functions/_shared/cripto.js);
  // as demais actions chamam requireUser() e exigem associação ao tenant.
  { name:'google-calendar-auth', purpose:'OAuth2 multi-tenant do Google Calendar: authorize, callback, status, update-settings e disconnect', trigger:'http-frontend', cron:null, auth:'publica', secrets:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_TOKENS_ENCRYPTION_KEY','PUBLIC_WEBHOOK_BASE_URL'], tables_read:['google_calendar_tokens','tenant_members'], tables_write:['google_calendar_tokens','tasks','google_token_audit_log'], external:['Google OAuth2','Google Calendar'], input:"GET ?action=callback&code&state; POST { action, tenant_id, ... }", output:'HTML de sucesso/erro com postMessage, ou JSON por action', complexity:'alta', notes:'redirect_uri = PUBLIC_WEBHOOK_BASE_URL + /google-calendar-auth?action=callback e precisa estar cadastrado no Google Cloud Console. Cifra AES-256-GCM em functions/_shared/cripto.js (era encrypt_token/pgcrypto).' },
  { name:'google-calendar-sync', purpose:'CRUD de eventos do Google Calendar e sincronização bidirecional com tasks', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'], tables_read:['google_calendar_tokens','tasks'], tables_write:['google_calendar_tokens','tasks'], external:['Google Calendar'], input:"{ action:'list-calendars'|'list-events'|'create-event'|'update-event'|'delete-event'|'import-events'|'sync-tasks', ... }", output:'varia por action', complexity:'alta', notes:'O original gravava token em texto plano aqui e cifrado no auth — unifique cifrando nos dois.' },
  { name:'hermes-mcp', purpose:'Servidor MCP HTTP que expõe 13 tools de tarefas/projetos/membros/lembretes por tenant', trigger:'http-webhook-externo', cron:null, auth:'api-key-tenant', secrets:[], tables_read:['tenant_api_keys','tenant_mcp_settings','tasks','subtasks','task_reminders','projects','tenant_members','profiles'], tables_write:['tenant_api_keys','tenant_api_audit_log','tasks','task_reminders'], external:[], input:'GET /health; POST /tools/list; POST /tools/call { name, arguments }', output:'{ tools[] } | { ok:true, name, result } | { ok:false, error }', complexity:'alta', notes:'Roteamento por req.path. Mantenha o hash SHA-256 da API key e o audit log a cada chamada.' },
  { name:'process-recurring-schedules', purpose:'Enfileira resumo diário e plano semanal quando bate o horário local do usuário', trigger:'cron', cron:'*/5 * * * *', auth:'servidor', secrets:[], tables_read:['recurring_schedules','tasks'], tables_write:['recurring_schedules','scheduled_reminders'], external:[], input:'nenhum', output:'{ ok, enqueued }', complexity:'media', notes:'Intl.DateTimeFormat com timeZone funciona igual no Node 22. Precisa rodar a cada ~5min para não perder a janela.' },
  { name:'reevaluate-deadlines', purpose:'Reavalia prazos: sobe urgência e usa IA para sugerir nova importância, criando sugestões de reclassificação', trigger:'cron', cron:'0 6 * * *', auth:'servidor', secrets:['AI_API_KEY'], tables_read:['tasks','projects','subtasks','task_attachments'], tables_write:['tasks','task_reclassification_suggestions','notifications'], external:['IA'], input:'vazio (cron) ou { user_id? }', output:'{ processed, urgencyApplied, suggestionsCreated, errors }', complexity:'alta', notes:'Usava join do PostgREST (tasks -> projects(...)). Troque por db.loadRelated("projects", ids).' },
  { name:'tenant-whatsapp-connect', purpose:'Cria a instância Evolution do WhatsApp corporativo do tenant e devolve o QR code', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY','EVOLUTION_WEBHOOK_URL','EVOLUTION_WEBHOOK_SECRET'], tables_read:['tenant_members'], tables_write:['tenant_whatsapp_connections'], external:['Evolution API'], input:'{ tenant_id }', output:'{ ok, instance_name, qr_code }', complexity:'media', notes:'RPC get_tenant_role -> requireTenantAdmin() do _shared/auth.js.' },
  { name:'tenant-whatsapp-verify-phone', purpose:'Envia e valida código OTP por WhatsApp para vincular telefone de um membro', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY'], tables_read:['tenant_member_phones','tenant_whatsapp_connections'], tables_write:['tenant_member_phones'], external:['Evolution API'], input:"{ action:'send'|'verify', tenant_id, phone_number?, code? }", output:'{ ok:true } | { ok:true, verified:true }', complexity:'media', notes:'O original gerava OTP com Math.random. Troque por crypto.randomInt — está no scaffold.' },
  { name:'whatsapp-connect', purpose:'Cria a instância Evolution pessoal do usuário, registra o webhook e devolve o QR code', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY','PUBLIC_WEBHOOK_BASE_URL','EVOLUTION_WEBHOOK_URL','EVOLUTION_WEBHOOK_SECRET'], tables_read:['whatsapp_connections'], tables_write:['whatsapp_connections'], external:['Evolution API'], input:'sem corpo (usa a sessão)', output:'{ status, qr_code, webhook_registered }', complexity:'media', notes:'A URL do webhook era montada com SUPABASE_URL. Agora vem de PUBLIC_WEBHOOK_BASE_URL + /whatsapp-webhook.' },
  { name:'whatsapp-deadline-reminders', purpose:'Envia mensagem agregada de tarefas vencendo agora/1h/24h respeitando horário e fuso de cada usuário', trigger:'cron', cron:'*/15 * * * *', auth:'servidor', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY'], tables_read:['whatsapp_connections','tasks','whatsapp_sent_reminders'], tables_write:['whatsapp_connections','whatsapp_sent_reminders'], external:['Evolution API'], input:'nenhum', output:'{ ok, sent }', complexity:'media', notes:'A unique (user_id, task_id, reminder_type) é o que impede reenvio — respeite ao gravar.' },
  { name:'whatsapp-disconnect', purpose:'Faz logout, apaga a instância Evolution do usuário e limpa o registro local', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY'], tables_read:['whatsapp_connections'], tables_write:['whatsapp_connections'], external:['Evolution API'], input:'nenhum', output:"{ status:'disconnected' }", complexity:'baixa', notes:'Só a checagem de sessão muda.' },
  { name:'whatsapp-report', purpose:'Monta e envia relatório diário ou semanal de produtividade por WhatsApp', trigger:'cron', cron:'0 * * * *', auth:'servidor', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY'], tables_read:['whatsapp_connections','tasks','productivity_metrics','gamification'], tables_write:[], external:['Evolution API'], input:"{ type?: 'weekly' } — sem o campo roda o diário", output:'{ type, sent }', complexity:'media', notes:'O original tinha UTC-3 fixo no código. Use whatsapp_connections.timezone, como faz o deadline-reminders.' },
  { name:'whatsapp-send', purpose:'Envia uma mensagem de texto via Evolution para um número, dado o instance_name', trigger:'http-interno', cron:null, auth:'servidor', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY','INTERNAL_FUNCTION_SECRET'], tables_read:[], tables_write:[], external:['Evolution API'], input:'{ instance_name, phone_number, message }', output:'{ success:true, data }', complexity:'baixa', notes:'FALHA DE SEGURANÇA no original: endpoint totalmente aberto, qualquer um disparava mensagem por qualquer instância. O scaffold já exige INTERNAL_FUNCTION_SECRET.' },
  { name:'whatsapp-status', purpose:'Consulta e sincroniza o estado da conexão WhatsApp pessoal com a Evolution', trigger:'http-frontend', cron:null, auth:'jwt-usuario', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY','EVOLUTION_WEBHOOK_URL','EVOLUTION_WEBHOOK_SECRET'], tables_read:['whatsapp_connections'], tables_write:['whatsapp_connections'], external:['Evolution API'], input:'nenhum', output:'{ status, phone_number?, webhook_registered? }', complexity:'media', notes:'Compartilha o padrão de webhook/set com whatsapp-connect.' },
  { name:'whatsapp-webhook', purpose:'Webhook da Evolution: processa comandos slash e linguagem natural com function-calling sobre tarefas', trigger:'http-webhook-externo', cron:null, auth:'publica', secrets:['EVOLUTION_API_URL','EVOLUTION_API_KEY','AI_API_KEY','EVOLUTION_WEBHOOK_SECRET'], tables_read:['tasks','team_members','profiles','whatsapp_chat_history','task_reminders','whatsapp_connections','whatsapp_processed_messages','teams','gamification','productivity_metrics'], tables_write:['tasks','whatsapp_chat_history','task_reminders','delegations','whatsapp_connections','whatsapp_processed_messages'], external:['Evolution API','IA'], input:'payload bruto da Evolution (event, instance, data.message, data.key...)', output:'{ ok:true } sempre — a resposta real volta pelo WhatsApp', complexity:'alta', notes:'A maior e mais arriscada. FALHA DE SEGURANÇA no original: nenhuma verificação de assinatura do payload. O scaffold valida EVOLUTION_WEBHOOK_SECRET. Dedup por whatsapp_processed_messages.' },
];

const bar = (s) => '─'.repeat(s);
const listOr = (a, empty = 'nenhuma') => (a?.length ? a.join(', ') : empty);

function scaffold(f) {
  const needsUser = f.auth === 'jwt-usuario';
  const needsApiKey = f.auth === 'api-key-tenant';
  const isCron = f.trigger === 'cron';
  const isWebhook = f.trigger === 'http-webhook-externo' && f.auth === 'publica';
  const isInternal = f.name === 'whatsapp-send';
  const usesAi = f.external.includes('IA');
  const usesEvo = f.external.includes('Evolution API');

  const imports = [
    "import { db, storage, Query } from '../_shared/appwrite.js';",
    needsUser || needsApiKey ? "import { requireUser, requireTenantAdmin, authenticateTenantApiKey } from '../_shared/auth.js';" : null,
    usesEvo ? "import { evolution, normalize } from '../_shared/evolution.js';" : null,
    usesAi ? "import { chat, imagePart } from '../_shared/ai.js';" : null,
    "import { body, query, err, isScheduled } from '../_shared/http.js';",
  ].filter(Boolean).join('\n');

  const guard = [];
  if (isCron) guard.push(`    // Só agendamento ou chamada manual autenticada.\n    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {\n      return res.json({ ok: false, error: 'somente execução agendada' }, 403);\n    }`);
  if (needsUser) guard.push(`    const user = await requireUser(req);`);
  if (needsApiKey) guard.push(`    const apiKey = await authenticateTenantApiKey(db, req.headers['x-api-key']);`);
  if (isWebhook) guard.push(`    // Correção de segurança: o original aceitava qualquer payload sem verificação.\n    const secret = process.env.EVOLUTION_WEBHOOK_SECRET;\n    if (secret && req.headers['x-webhook-secret'] !== secret) {\n      return res.json({ ok: false }, 401);\n    }`);
  if (isInternal) guard.push(`    // Correção de segurança: o original era um endpoint aberto de envio de WhatsApp.\n    if (req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {\n      return res.json({ ok: false, error: 'não autorizado' }, 401);\n    }`);

  return `/**
 * ${f.name}
 * ${bar(70)}
 * ${f.purpose}
 *
 * Origem: supabase/functions/${f.name}/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20.0
 *
 * Gatilho .......... ${f.trigger}${f.cron ? `  (cron: ${f.cron.replaceAll('*/', '*\\/')})` : ''}
 * Autenticação ..... ${f.auth}
 * Entrada .......... ${f.input}
 * Saída ............ ${f.output}
 * Lê ............... ${listOr(f.tables_read)}
 * Escreve .......... ${listOr(f.tables_write)}
 * APIs externas .... ${listOr(f.external, 'nenhuma')}
 * Variáveis ........ ${listOr(f.secrets, 'nenhuma além das do Appwrite')}
 * Complexidade ..... ${f.complexity}
 *
 * ATENÇÃO NO PORTE:
 *   ${f.notes}
 */
${imports}

export default async ({ req, res, log, error }) => {
  try {
${guard.join('\n\n')}

    const input = body(req);

    // ${bar(66)}
    // PORTAR: a lógica de negócio vive em supabase/functions/${f.name}/index.ts.
    // Transponha para cá usando os helpers acima. Equivalências:
    //   supabase.from('x').select().eq('a', v)  ->  db.list('x', [Query.equal('a', v)])
    //   supabase.from('x').insert({...})        ->  db.create('x', {...}, permissions)
    //   supabase.from('x').update({...}).eq()   ->  db.update('x', id, {...})
    //   supabase.from('x').delete().eq()        ->  db.delete('x', id)
    //   select('*, rel(...)')                   ->  db.loadRelated('rel', ids)
    //   supabase.auth.getUser()                 ->  requireUser(req)
    //   supabase.rpc('get_tenant_role', ...)    ->  getTenantRole(db, tenantId, userId)
    //   supabase.storage.createSignedUrl()      ->  storage.asDataUrl(bucketId, fileId)
    //   fetch(LOVABLE_AI_GATEWAY)               ->  chat({ messages, tools })
    // ${bar(66)}

    log(\`${f.name}: recebido \${JSON.stringify(input).slice(0, 200)}\`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de ${f.name}' });
  } catch (e) {
    error(\`${f.name}: \${e.message}\`);
    return err(res, e);
  }
};
`;
}

// ------------------------------------------------------------------ escrita
// Só gera arquivos quando executado direto. Outros scripts (deploy-functions.mjs)
// importam FUNCTIONS daqui e não devem disparar geração como efeito colateral.
const EXECUTADO_DIRETO = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!EXECUTADO_DIRETO) {
  // exporta só os dados
} else {
gerar();
}

function gerar() {
let created = 0;
for (const f of FUNCTIONS) {
  const dir = resolve(ROOT, 'functions', f.name, 'src');
  mkdirSync(dir, { recursive: true });
  const main = resolve(dir, 'main.js');
  if (!existsSync(main)) { writeFileSync(main, scaffold(f)); created++; }
  writeFileSync(resolve(ROOT, 'functions', f.name, 'package.json'), JSON.stringify({
    name: `eisenflow-${f.name}`, version: '1.0.0', type: 'module',
    main: 'src/main.js', dependencies: {},
  }, null, 2) + '\n');
}

// ------------------------------------------------------------- appwrite.json
const allSecrets = [...new Set(FUNCTIONS.flatMap((f) => f.secrets))].sort();
const config = {
  projectId: process.env.APPWRITE_PROJECT_ID || 'default-6a987e930039a4a13bea',
  projectName: 'EisenFlow',
  functions: FUNCTIONS.map((f) => ({
    $id: f.name,
    name: f.name,
    runtime: RUNTIME,
    execute: f.auth === 'jwt-usuario' ? ['users'] : (f.auth === 'publica' ? ['any'] : []),
    events: [],
    schedule: f.cron || '',
    timeout: f.complexity === 'alta' ? 300 : 60,
    enabled: true,
    logging: true,
    entrypoint: 'src/main.js',
    commands: '',
    path: `functions/${f.name}`,
    scopes: [
      'databases.read', 'documents.read', 'documents.write',
      ...(f.tables_write.length ? ['collections.read'] : []),
      ...(f.name === 'analyze-task-image' || f.name === 'whatsapp-webhook' ? ['files.read', 'files.write'] : []),
      ...(f.auth === 'jwt-usuario' ? ['users.read'] : []),
    ],
  })),
};
writeFileSync(resolve(ROOT, 'appwrite.json'), JSON.stringify(config, null, 2) + '\n');

console.log(`functions: ${FUNCTIONS.length} (${created} main.js novos)`);
console.log(`crons: ${FUNCTIONS.filter((f) => f.cron).length}`);
console.log(`secrets distintos: ${allSecrets.length} -> ${allSecrets.join(', ')}`);
}
