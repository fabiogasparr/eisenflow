/**
 * analyze-task-image
 * ──────────────────────────────────────────────────────────────────────
 * OCR, descrição visual e sugestão de subtarefas sobre imagem anexada a uma tarefa.
 *
 * Chamada ........... front (JWT), useTaskAttachments.ts
 * Entrada ........... { attachment_id, task_title?, task_description? }
 * Saída ............. { ocr_text, description, suggested_subtasks[] }
 * Lê ................ task_attachments, tasks, tenant_members, Storage task-attachments
 * Escreve ........... task_attachments (ocr_text, ai_description, ai_analyzed_at)
 * Env ............... AI_API_KEY (+ AI_MODEL_VISAO opcional)
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  - O original gerava uma signed URL do Storage e mandava ao provider de IA
 *    buscá-la. No self-hosted o Storage pode não ser alcançável de fora (e o
 *    OmniRoute é outro serviço). O arquivo é baixado aqui com a service role e
 *    vai como data URL — nenhuma URL do anexo sai do servidor.
 *  - Modelo fixo google/gemini-2.5-pro -> finalidade 'visao' em _shared/ai.ts.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chat, imagePart, type Tool } from '../_shared/ai.ts';
import { admin, requireUser } from '../_shared/supabase.ts';
import { bytesParaDataUrl } from '../_shared/bytes.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

const SYSTEM =
  'Você analisa imagens anexadas a tarefas. Faça OCR completo, descreva o conteúdo visual ' +
  'e sugira subtarefas acionáveis quando fizer sentido. Responda no idioma do usuário.';

const TOOL: Tool = {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const { attachment_id, task_title, task_description } = await lerCorpo(req);
    if (!attachment_id) throw erro('attachment_id é obrigatório', 400);
    const db = admin();

    const { data: att } = await db
      .from('task_attachments')
      .select('id, task_id, storage_path, mime_type, uploaded_by')
      .eq('id', attachment_id)
      .maybeSingle();
    if (!att) throw erro('Anexo não encontrado', 404);
    if (!/^image\//.test(att.mime_type || '')) throw erro(`Anexo não é imagem (${att.mime_type})`, 400);

    const { data: task } = await db
      .from('tasks')
      .select('id, created_by, assigned_to, tenant_id, title, description')
      .eq('id', att.task_id)
      .maybeSingle();
    if (!task) throw erro('Tarefa não encontrada', 404);

    // Service role ignora RLS: a autorização é explícita — criador, responsável, ou membro do tenant.
    let permitido = task.created_by === user.id || task.assigned_to === user.id;
    if (!permitido && task.tenant_id) {
      const { data: membro } = await db
        .from('tenant_members').select('id')
        .eq('tenant_id', task.tenant_id).eq('user_id', user.id).maybeSingle();
      permitido = !!membro;
    }
    if (!permitido) throw erro('Sem acesso a esta tarefa', 403);

    const { data: arquivo, error: dlErr } = await db.storage.from('task-attachments').download(att.storage_path);
    if (dlErr || !arquivo) throw erro(`Não foi possível baixar o anexo: ${dlErr?.message || 'vazio'}`, 500);
    const dataUrl = bytesParaDataUrl(new Uint8Array(await arquivo.arrayBuffer()), att.mime_type || 'image/png');

    const contexto = `Tarefa pai: "${task_title || task.title}"\n${task_description || task.description || ''}`.trim();

    const result = await chat({
      // OCR de foto torta e mal iluminada: vale o melhor modelo de visão.
      proposito: 'visao',
      temperature: 0.1,
      tools: [TOOL],
      toolChoice: 'analyze_image',
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
    if (!call && !result.content) throw erro('A IA não devolveu análise', 502);
    if (!call) console.log('analyze-task-image: sem tool call, usando o texto livre como descrição');

    const ocr = String(call?.arguments?.ocr_text || '');
    const descricao = String(call?.arguments?.description || result.content || '');
    const subtarefas: string[] = Array.isArray(call?.arguments?.suggested_subtasks)
      ? call!.arguments.suggested_subtasks.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).map((s: string) => s.slice(0, 500))
      : [];

    await db.from('task_attachments').update({
      ocr_text: ocr || null,
      ai_description: descricao || null,
      ai_analyzed_at: new Date().toISOString(),
    }).eq('id', att.id);

    console.log(`analyze-task-image: anexo ${att.id} analisado (${ocr.length} chars de OCR, ${subtarefas.length} subtarefas)`);
    return json({ ocr_text: ocr, description: descricao, suggested_subtasks: subtarefas });
  } catch (e) {
    console.error('analyze-task-image:', e);
    return respostaErro(e);
  }
});
