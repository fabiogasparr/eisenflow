import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: claims, error: authErr } = await supabaseAuth.auth.getClaims(token);
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    const { attachment_id, task_title, task_description } = await req.json();
    if (!attachment_id) throw new Error("attachment_id required");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: att, error: attErr } = await supabase
      .from("task_attachments")
      .select("id, task_id, storage_path, mime_type, uploaded_by")
      .eq("id", attachment_id)
      .maybeSingle();

    if (attErr || !att) {
      return new Response(JSON.stringify({ error: "Attachment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller can access the parent task
    const { data: task } = await supabase
      .from("tasks")
      .select("id, created_by, assigned_to, tenant_id, title, description")
      .eq("id", att.task_id)
      .maybeSingle();

    if (!task) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const canAccess = task.created_by === userId || task.assigned_to === userId;
    if (!canAccess) {
      // Allow tenant member access
      if (task.tenant_id) {
        const { data: tm } = await supabase
          .from("tenant_members")
          .select("id")
          .eq("tenant_id", task.tenant_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!tm) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Sign URL
    const { data: signed, error: signErr } = await supabase.storage
      .from("task-attachments")
      .createSignedUrl(att.storage_path, 60 * 60);

    if (signErr || !signed?.signedUrl) {
      throw new Error("Could not sign URL");
    }

    const tools = [{
      type: "function",
      function: {
        name: "analyze_image",
        description: "Returns OCR text, a visual description, and optional subtask suggestions",
        parameters: {
          type: "object",
          properties: {
            ocr_text: { type: "string", description: "All readable text extracted from the image" },
            description: { type: "string", description: "Concise description of what the image shows" },
            suggested_subtasks: {
              type: "array",
              items: { type: "string" },
              description: "Optional actionable subtasks inferred from the image content",
            },
          },
          required: ["ocr_text", "description", "suggested_subtasks"],
          additionalProperties: false,
        },
      },
    }];

    const taskCtx = `Tarefa pai: "${task_title || task.title}"\n${task_description || task.description || ""}`.trim();

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: "Você analisa imagens anexadas a tarefas. Faça OCR completo, descreva o conteúdo visual e sugira subtarefas acionáveis quando fizer sentido. Responda no idioma do usuário.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Analise a imagem anexada a esta tarefa.\n\n${taskCtx}` },
              { type: "image_url", image_url: { url: signed.signedUrl } },
            ],
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "analyze_image" } },
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      const text = await aiRes.text();
      console.error("AI gateway error:", status, text);
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Limite excedido. Tente novamente em segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI analysis failed");
    }

    const data = await aiRes.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No analysis result");

    const result = JSON.parse(toolCall.function.arguments);

    // Persist OCR + description
    await supabase
      .from("task_attachments")
      .update({
        ocr_text: result.ocr_text || null,
        ai_description: result.description || null,
        ai_analyzed_at: new Date().toISOString(),
      })
      .eq("id", attachment_id);

    return new Response(JSON.stringify({
      ocr_text: result.ocr_text || "",
      description: result.description || "",
      suggested_subtasks: result.suggested_subtasks || [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-task-image error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
