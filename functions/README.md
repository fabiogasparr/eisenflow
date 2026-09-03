# functions/ — Appwrite Functions

20 funções, runtime `node-20.0`, entrypoint `src/main.js`, sem dependências npm
(tudo em `_shared/` usa só o fetch nativo).

## Estado

| Estado | Funções |
|---|---|
| **Portadas** | `whatsapp-send`, `classify-task`, `cleanup-reminders` |
| **Esqueleto** | as outras 17 |

Um esqueleto tem o contrato completo (entrada, saída, secrets, collections,
armadilhas do porte) e o scaffold ligado — falta transpor a lógica do arquivo
Deno original, marcada com o bloco `PORTAR:`.

## Helpers compartilhados

| Módulo | Substitui |
|---|---|
| `_shared/appwrite.js` | `createClient` do supabase-js — `db.list/create/update/delete`, `Query`, `storage`, `users`, `teams`, `loadRelated` |
| `_shared/auth.js` | `supabase.auth.getUser()` e as funções RLS de tenant |
| `_shared/evolution.js` | as chamadas soltas à Evolution API espalhadas nas 9 funções de WhatsApp |
| `_shared/ai.js` | o Lovable AI Gateway — agora aponta para o OmniRoute self-hospedado (`https://omniroute.kz3solucoes.cloud/v1`), protocolo OpenAI |
| `_shared/http.js` | parsing de corpo, resposta e detecção de execução agendada |

## Equivalências ao portar

```js
supabase.from('tasks').select('*').eq('created_by', id)
db.list('tasks', [Query.equal('created_by', id)])

supabase.from('tasks').insert({...}).select().single()
db.create('tasks', {...}, permissions)

supabase.from('tasks').update({...}).eq('id', id)
db.update('tasks', id, {...})

supabase.from('tasks').select('*, projects(name)')     // join do PostgREST
const tasks = await db.list('tasks', [...]);
const projects = await db.loadRelated('projects', tasks.documents.map(t => t.project_id));

supabase.auth.getUser()          ->  requireUser(req)
supabase.rpc('get_tenant_role')  ->  getTenantRole(db, tenantId, userId)
supabase.storage.createSignedUrl ->  storage.asDataUrl(bucketId, fileId)
fetch(LOVABLE_AI_GATEWAY)        ->  chat({ messages, tools })
```

## Deploy

```bash
appwrite login
appwrite push functions            # todas
appwrite push functions --function-id classify-task
```

Cada function precisa das suas variáveis cadastradas (console → Function →
Settings → Variables), além de `APPWRITE_API_KEY`.

## Duas correções de segurança já embutidas

- `whatsapp-send` exige `x-internal-secret`. No Supabase era um endpoint aberto:
  qualquer um disparava WhatsApp por qualquer instância conectada.
- `whatsapp-webhook` valida `EVOLUTION_WEBHOOK_SECRET`. No Supabase aceitava
  qualquer POST como se viesse da Evolution.
