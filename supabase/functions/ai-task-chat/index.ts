import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Você é um assistente de produtividade inteligente do EisenFlow, especializado na Matriz de Eisenhower.

Quando o usuário descrever uma tarefa ou projeto, você deve:
1. Analisar a descrição e criar tarefas estruturadas
2. Classificar cada tarefa no quadrante correto da Matriz de Eisenhower
3. Para projetos complexos, quebrar em subtarefas menores e acionáveis
4. Se houver membros de time disponíveis, sugerir atribuições inteligentes

QUANDO O USUÁRIO ENVIAR IMAGENS (prints, fotos, recibos, post-its, agendas, e-mails, atas, fluxogramas):
- Faça OCR cuidadoso e extraia TODO o texto visível
- Descreva o conteúdo visual quando relevante (gráficos, diagramas, layouts)
- Identifique itens acionáveis (listas, tópicos, deadlines, decisões) e use a tool create_tasks
- Se a imagem for apenas informativa (sem ação), responda com chat_response resumindo o que viu
- Inclua na descrição da tarefa o trecho do texto extraído da imagem que originou a tarefa

Quadrantes da Matriz de Eisenhower:
- "do": Fazer Agora — Urgente E Importante (crises, deadlines imediatos)
- "schedule": Agendar — Importante mas NÃO Urgente (planejamento, crescimento)
- "delegate": Delegar — Urgente mas NÃO Importante (interrupções, reuniões rotineiras)
- "eliminate": Eliminar — NÃO Urgente e NÃO Importante (distrações, tarefas desnecessárias)

Urgência e Importância são valores de 1 a 5.

Sempre use a tool create_tasks quando o usuário descrever (em texto ou imagem) tarefas ou projetos.
Use chat_response para respostas conversacionais que não envolvam criação de tarefas.

Responda sempre no idioma que o usuário usar.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context, images } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let contextInfo = "";
    if (context?.teamMembers?.length) {
      contextInfo += `\n\nMembros do time disponíveis para atribuição:\n${context.teamMembers.map((m: any) => `- ${m.name} (ID: ${m.id})`).join("\n")}`;
    }
    if (context?.projects?.length) {
      contextInfo += `\n\nProjetos disponíveis:\n${context.projects.map((p: any) => `- ${p.name} (ID: ${p.id})`).join("\n")}`;
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "create_tasks",
          description: "Create one or more tasks from the user's description or images. Use this whenever the user describes (or shows in an image) work to be done.",
          parameters: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Task title, concise and actionable" },
                    description: { type: "string", description: "Detailed description; include relevant text extracted from images" },
                    quadrant: { type: "string", enum: ["do", "schedule", "delegate", "eliminate"] },
                    urgency: { type: "number", minimum: 1, maximum: 5 },
                    importance: { type: "number", minimum: 1, maximum: 5 },
                    estimated_time: { type: "number", description: "Estimated time in minutes" },
                    assigned_to_id: { type: "string" },
                    assigned_to_name: { type: "string" },
                    project_id: { type: "string" },
                  },
                  required: ["title", "quadrant", "urgency", "importance"],
                  additionalProperties: false,
                },
              },
              summary: { type: "string", description: "Brief summary of what was created and why; mention image content when applicable" },
            },
            required: ["tasks", "summary"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "chat_response",
          description: "Send a conversational response when no task creation is needed. Use this to summarize/describe an image when it isn't actionable.",
          parameters: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    ];

    // If images were sent with the latest user message, transform that message into multimodal content.
    const hasImages = Array.isArray(images) && images.length > 0;
    const apiMessages = [...messages];
    if (hasImages && apiMessages.length > 0) {
      const lastIdx = apiMessages.length - 1;
      const last = apiMessages[lastIdx];
      if (last?.role === "user") {
        const textPart = typeof last.content === "string" ? last.content : "";
        apiMessages[lastIdx] = {
          role: "user",
          content: [
            { type: "text", text: textPart || "Analise a(s) imagem(ns) anexada(s)." },
            ...images.map((url: string) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        };
      }
    }

    // Use a vision-capable model when images are present.
    const model = hasImages ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextInfo },
          ...apiMessages,
        ],
        tools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const text = await response.text();
      console.error("AI gateway error:", status, text);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao seu workspace." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Erro ao processar com IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (choice.message?.tool_calls?.length) {
      const toolCall = choice.message.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);

      if (toolCall.function.name === "create_tasks") {
        return new Response(JSON.stringify({
          type: "tasks",
          tasks: args.tasks,
          summary: args.summary,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (toolCall.function.name === "chat_response") {
        return new Response(JSON.stringify({
          type: "chat",
          message: args.message,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      type: "chat",
      message: choice.message?.content || "Não entendi. Pode reformular?",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-task-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
