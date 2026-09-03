/**
 * analyze-task-image
 * ──────────────────────────────────────────────────────────────────────
 * OCR, descrição visual e sugestão de subtarefas sobre imagem anexada a uma tarefa.
 *
 * Origem: supabase/functions/analyze-task-image/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... sessão/JWT do usuário
 * Entrada .......... { attachment_id, task_title?, task_description? }
 * Saída ............ { ocr_text, description, suggested_subtasks[] }
 * Lê ............... task_attachments, tasks, tenant_members
 * Escreve .......... task_attachments (ocr_text, ai_description, ai_analyzed_at)
 * APIs externas .... IA (_shared/ai.js -> OmniRoute)
 * Variáveis ........ AI_API_KEY, APPWRITE_API_KEY
 *
 * MUDANÇAS EM RELAÇÃO AO ORIGINAL:
 *  - createSignedUrl do Supabase Storage não existe aqui. O arquivo é baixado
 *    pela API key da function e vira data URL (storage.asDataUrl). Vantagem:
 *    nenhuma URL do anexo sai do servidor; o bucket task-attachments tem
 *    fileSecurity=true e o provider de IA nunca conseguiria buscá-la sozinho.
 *  - Modelo fixo google/gemini-2.5-pro -> proposito 'visao' em _shared/ai.js.
 *  - O original forçava tool_choice na tool analyze_image. chat() só faz
 *    tool_choice:'auto', então há fallback: sem tool call, o texto livre da
 *    resposta vira a descrição.
 */
import { db, storage, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';
import { requireUser } from '../_shared/auth.js';
import { chat, imagePart } from '../_shared/ai.js';
import { body, err } from '../_shared/http.js';

const SYSTEM =
  'Você analisa imagens anexadas a tarefas. Faça OCR completo, descreva o conteúdo visual ' +
  'e sugira subtarefas acionáveis quando fizer sentido. Responda no idioma do usuário.';

const TOOL = {
  type: 'function',
  function: {
    name: 'analyze_image',
    description: 'Returns OCR text, a visual description, and optional subtask suggestions',
    parameters: {
      type: 'object',
      properties: {
        ocr_text: { type: 'string', description: 'All readable text extracted from the image' },
        description: { type: 'string', description: 'Concise description of what the image shows' },
        suggested_subtasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional actionable subtasks inferred from the image content',
        },
      },
      required: ['ocr_text', 'description', 'suggested_subtasks'],
      additionalProperties: false,
    },
  },
};

/**
 * db.update() carimba updated_at sempre, e task_attachments não tem esse
 * atributo (o schema só guarda created_at) — o Appwrite rejeitaria a escrita.
 * Por isso o PATCH aqui é direto, sem o carimbo.
 */
const patchAnexo = (id, data) =>
  rawCall('PATCH', `/databases/${DATABASE_ID}/collections/task_attachments/documents/${id}`, { data });

const naoEncontrado = (msg) => { const e = new Error(msg); e.status = 404; return e; };
const proibido = () => { const e = new Error('Sem acesso a esta tarefa'); e.status = 403; return e; };

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const { attachment_id, task_title, task_description } = body(req);
    if (!attachment_id) return res.json({ ok: false, error: 'attachment_id é obrigatório' }, 400);

    // No Postgres o anexo tinha coluna "id"; no Appwrite a identidade é o $id.
    let att;
    try {
      att = await db.get('task_attachments', attachment_id);
    } catch {
      throw naoEncontrado('Anexo não encontrado');
    }

    if (!/^image\//.test(att.mime_type || '')) {
      return res.json({ ok: false, error: `Anexo não é imagem (${att.mime_type})` }, 400);
    }

    let task;
    try {
      task = await db.get('tasks', att.task_id);
    } catch {
      throw naoEncontrado('Tarefa não encontrada');
    }

    // Sem RLS, a autorização é explícita: criador, responsável, ou membro do tenant.
    let permitido = task.created_by === user.$id || task.assigned_to === user.$id;
    if (!permitido && task.tenant_id) {
      const membro = await db.findOne('tenant_members', [
        Query.equal('tenant_id', task.tenant_id),
        Query.equal('user_id', user.$id),
      ]);
      permitido = !!membro;
    }
    if (!permitido) throw proibido();

    // storage_path era o caminho do Supabase; no Appwrite o que vale é bucket+file.
    // Mantido o fallback para storage_path porque o schema conserva o campo antigo.
    const bucketId = att.bucket_id || 'task-attachments';
    const fileId = att.file_id || att.storage_path;
    if (!fileId) throw naoEncontrado('Anexo sem file_id no Storage');

    const dataUrl = await storage.asDataUrl(bucketId, fileId, att.mime_type);

    const contexto = `Tarefa pai: "${task_title || task.title}"\n${task_description || task.description || ''}`.trim();

    const result = await chat({
      // OCR de foto torta e mal iluminada: vale o melhor modelo de visão.
      proposito: 'visao',
      temperature: 0.1,
      tools: [TOOL],
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analise a imagem anexada a esta tarefa.\n\n${contexto}` },
            imagePart(dataUrl),
          ],
        },
      ],
    });

    const call = result.toolCalls.find((c) => c.name === 'analyze_image');
    if (!call && !result.content) throw new Error('A IA não devolveu análise');
    if (!call) log('analyze-task-image: sem tool call, usando o texto livre como descrição');

    // Truncagem pelos limites reais dos atributos (appwrite/schema.mjs).
    const ocr = String(call?.arguments?.ocr_text || '').slice(0, 65535);
    const descricao = String(call?.arguments?.description || result.content || '').slice(0, 20000);
    const subtarefas = Array.isArray(call?.arguments?.suggested_subtasks)
      ? call.arguments.suggested_subtasks.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.slice(0, 500))
      : [];

    // Persiste no anexo. Não recalcula permissões: o anexo já herdou as da tarefa
    // e a titularidade não mudou aqui.
    await patchAnexo(att.$id, {
      ocr_text: ocr || null,
      ai_description: descricao || null,
      ai_analyzed_at: new Date().toISOString(),
    });

    log(`analyze-task-image: anexo ${att.$id} analisado (${ocr.length} chars de OCR, ${subtarefas.length} subtarefas)`);
    return res.json({ ocr_text: ocr, description: descricao, suggested_subtasks: subtarefas });
  } catch (e) {
    error(`analyze-task-image: ${e.message}`);
    return err(res, e);
  }
};
