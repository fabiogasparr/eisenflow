# Guia de conversão Supabase → Appwrite

Referência única para migrar os hooks, páginas e componentes do EisenFlow.
**Siga isto ao pé da letra** — a consistência entre arquivos importa mais do que
a elegância de cada um.

## Imports

```ts
// SAI
import { supabase } from '@/integrations/supabase/client';

// ENTRA (só o que o arquivo usar)
import { create, update, remove, upsert, getById, list, listDocs, listAll,
         findOne, loadRelated, parseJson, toJson, Query } from '@/integrations/appwrite/database';
import { subscribeCollection } from '@/integrations/appwrite/realtime';
import { invoke } from '@/integrations/appwrite/functions';
import { uploadFile, deleteFile, fileViewUrl, fileOwnerPermissions } from '@/integrations/appwrite/files';
import { taskPermissions, projectPermissions, ownerOnly } from '@/integrations/appwrite/permissions';
import { getCurrentUser } from '@/integrations/appwrite/auth';
```

## Regra número um: `user.id` vira `user.$id`

O objeto de usuário do Appwrite usa `$id`. **Toda** ocorrência de `user.id`
(inclusive dentro de `queryKey`) vira `user.$id`.

Nos **documentos** é o contrário: a camada de dados já devolve um campo `id`
espelhando `$id`, então `task.id`, `project.id` etc. continuam funcionando.
Não mexa nos componentes por causa disso.

## Consultas

```ts
// SELECT
const { data, error } = await supabase.from('tasks').select('*').eq('created_by', uid);
if (error) throw error;
// ->
const docs = await listDocs('tasks', [Query.equal('created_by', uid)]);

// .maybeSingle() / .single()
const { data } = await supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle();
// ->
const doc = await findOne('profiles', [Query.equal('user_id', uid)]);

// .order()
.order('position', { ascending: true })   -> Query.orderAsc('position')
.order('created_at', { ascending: false }) -> Query.orderDesc('created_at')

// .in() / .limit() / .range()
.in('id', ids)      -> Query.equal('$id', ids)
.limit(50)          -> Query.limit(50)
.range(0, 49)       -> Query.limit(50), Query.offset(0)

// .or()
.or('a.eq.1,b.eq.2') -> Query.or([Query.equal('a', 1), Query.equal('b', 2)])

// .ilike('title', `%${termo}%`)  -> Query.search('title', termo)
//   (só funciona em campo com índice fulltext: tasks.title e profiles.display_name)
```

**Teto de 100 documentos por request.** Se a lista pode passar disso (tarefas,
notificações, lembretes), use `listAll(...)`, que pagina com cursor.

## Sem joins

```ts
// SAI — join embutido do PostgREST
const { data } = await supabase.from('tasks').select('*, projects(name, color)');

// ENTRA — duas queries e junção em memória
const tasks = await listDocs('tasks');
const projetos = await loadRelated('projects', tasks.map(t => t.project_id));
const comProjeto = tasks.map(t => ({ ...t, project: t.project_id ? projetos.get(t.project_id) ?? null : null }));
```

## Escrita

```ts
// INSERT
await supabase.from('subtasks').insert({ ... });
// ->
await create('subtasks', { ... }, permissoes);

// UPDATE
await supabase.from('tasks').update({ x }).eq('id', id);
// ->
await update('tasks', id, { x });

// DELETE
await supabase.from('tasks').delete().eq('id', id);
// ->
await remove('tasks', id);

// UPSERT
await supabase.from('gamification').upsert({ user_id: uid, xp }, { onConflict: 'user_id' });
// ->
await upsert('gamification', [Query.equal('user_id', uid)], { user_id: uid, xp }, ownerOnly(uid));
```

`created_at` e `updated_at` são preenchidos automaticamente — não passe.

## Permissões: o ponto onde essa migração quebra em silêncio

No Postgres a RLS era avaliada a cada query. No Appwrite a regra fica **gravada
no documento**. Consequência:

1. **Todo `create` de documento de usuário precisa passar permissões.** Sem isso
   ninguém enxerga o registro depois.
2. **Toda mudança de titularidade precisa RECALCULAR as permissões** — delegar
   uma tarefa (`assigned_to`), compartilhar (`task_shares`), mover de tenant.
   Passe o terceiro argumento de `update()`.

```ts
create('tasks', dados, taskPermissions({ createdBy: uid, assignedTo, tenantTeamId }));
create('projects', dados, projectPermissions({ ownerId: uid, tenantTeamId }));
create('subtasks', dados, ownerOnly(uid));           // ou herde as da tarefa pai
```

Collections `server`/`server-doc` (notifications, user_badges, scheduled_reminders,
whatsapp_*, tenant_api_keys, google_calendar_tokens) **não aceitam escrita do
cliente** — quem escreve é uma Function. No cliente, só leitura.

## Sem CASCADE

O Appwrite não tem `ON DELETE CASCADE`. Ao apagar um pai, apague os filhos antes.
Já existe `deleteTaskCascade(taskId)` exportado de `@/hooks/useTasks` — use-o em
vez de reimplementar.

## Realtime

```ts
// SAI
const channel = supabase.channel('x').on('postgres_changes',
  { event: '*', schema: 'public', table: 'tasks', filter: `created_by=eq.${uid}` },
  () => { ... }).subscribe();
return () => { supabase.removeChannel(channel); };

// ENTRA — o unsubscribe já é a função de retorno
return subscribeCollection('tasks', () => { ... });
```

O `filter` do Supabase some: o Appwrite só entrega evento de documento que a
sessão pode ler, então o recorte já vem da permissão.

## Functions

```ts
// SAI
const { data, error } = await supabase.functions.invoke('classify-task', { body: { title } });
if (error) throw error;
// ENTRA (lança em caso de erro)
const data = await invoke<{ quadrant: string }>('classify-task', { title });
```

## Storage

```ts
// SAI
await supabase.storage.from('task-attachments').upload(`${taskId}/${nome}`, file);
const { data } = supabase.storage.from('task-attachments').createSignedUrl(path, 3600);
// ENTRA
const f = await uploadFile('task-attachments', file, fileOwnerPermissions(uid));
const url = fileViewUrl('task-attachments', f.$id);
// e grave bucket_id + file_id em task_attachments
```

## jsonb

Campos que eram `jsonb` (`metadata`, `payload`, `signals`, `input_preview`)
viajam como string JSON: `parseJson(doc.metadata, {})` para ler,
`toJson(obj)` para gravar.

## O que NÃO existe mais

- `supabase.rpc(...)` — as funções SQL viraram código. `get_tenant_role` e afins
  vêm de `useTenantContext().myRole` no cliente, ou de uma Function no servidor.
- Tabelas de 2FA, rotação de token, rate limit por IP e sessão: o Appwrite
  resolve nativamente. Arquivos em `src/services/` e `src/middleware/` que
  dependiam delas devem passar a usar a API nativa (`account.*`) ou ser marcados
  como obsoletos — **não** recrie as tabelas.

## Ao terminar um arquivo

- Nenhuma linha com `supabase` sobrando (nem em comentário).
- Nenhum `user.id` — só `user.$id`.
- `npx tsc --noEmit` sem erro novo por sua causa.
- Comentários em português, explicando só o que não é óbvio (em especial cada
  ponto onde permissões são calculadas).
