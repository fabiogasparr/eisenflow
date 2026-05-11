import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Quadrant = "do" | "schedule" | "delegate" | "eliminate";

function urgencyFromDue(dueIso: string | null): number | null {
  if (!dueIso) return null;
  const ms = new Date(dueIso).getTime() - Date.now();
  const hours = ms / 36e5;
  if (hours <= 24) return 5;
  if (hours <= 72) return 4;
  if (hours <= 24 * 7) return 3;
  return null;
}

function quadrantFor(urgency: number, importance: number): Quadrant {
  const u = urgency >= 3;
  const i = importance >= 3;
  if (u && i) return "do";
  if (!u && i) return "schedule";
  if (u && !i) return "delegate";
  return "eliminate";
}

async function aiImportance(dossier: Record<string, unknown>, apiKey: string): Promise<{ importance: number; reason: string } | null> {
  const prompt = `You evaluate task IMPORTANCE (1-5) on the Eisenhower Matrix.
Importance reflects long-term value, alignment with goals/projects, and consequences of NOT doing it.
Use the dossier (content + user history signals). Return importance 1-5 and a short reason (max 140 chars, in Brazilian Portuguese).

Dossier:
${JSON.stringify(dossier, null, 2)}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "user", content: prompt }],
      tools: [{
        type: "function",
        function: {
          name: "rate_importance",
          description: "Rate task importance 1-5 with reasoning",
          parameters: {
            type: "object",
            properties: {
              importance: { type: "number", minimum: 1, maximum: 5 },
              reason: { type: "string" },
            },
            required: ["importance", "reason"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "rate_importance" } },
    }),
  });
  if (!r.ok) {
    console.error("AI error", r.status, await r.text());
    return null;
  }
  const data = await r.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) return null;
  try {
    const parsed = JSON.parse(tc.function.arguments);
    return { importance: Math.round(parsed.importance), reason: String(parsed.reason).slice(0, 200) };
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    let targetUserId: string | null = null;
    try {
      const body = await req.json();
      if (body?.user_id) targetUserId = body.user_id;
    } catch { /* no body = scheduled run */ }

    // If invoked via HTTP with auth header, derive user (manual mode)
    if (!targetUserId) {
      const auth = req.headers.get("Authorization");
      if (auth?.startsWith("Bearer ")) {
        const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: auth } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) targetUserId = user.id;
      }
    }

    const horizon = new Date(Date.now() + 7 * 24 * 36e5).toISOString();
    let q = admin.from("tasks")
      .select("id, title, description, tags, urgency, importance, quadrant, due_date, created_by, project_id, projects(name, team_id, tenant_id)")
      .in("status", ["pending", "in_progress"])
      .not("due_date", "is", null)
      .lte("due_date", horizon);
    if (targetUserId) q = q.eq("created_by", targetUserId);

    const { data: tasks, error } = await q;
    if (error) throw error;

    const stats = { processed: 0, urgencyApplied: 0, suggestionsCreated: 0, errors: 0 };

    for (const t of tasks ?? []) {
      stats.processed++;
      try {
        const newUrg = urgencyFromDue(t.due_date);
        if (newUrg === null) continue;

        // 1) Apply urgency rule (only if higher)
        const appliedUrg = Math.max(newUrg, t.urgency ?? 3);
        if (appliedUrg !== t.urgency) {
          const urgOnlyQuadrant = quadrantFor(appliedUrg, t.importance ?? 3);
          await admin.from("tasks")
            .update({ urgency: appliedUrg, quadrant: urgOnlyQuadrant })
            .eq("id", t.id);
          stats.urgencyApplied++;
        }

        // 2) Build dossier for AI
        const proj: any = (t as any).projects;
        const [{ count: subCount }, { count: attCount }, { data: history }] = await Promise.all([
          admin.from("subtasks").select("id", { count: "exact", head: true }).eq("task_id", t.id),
          admin.from("task_attachments").select("id", { count: "exact", head: true }).eq("task_id", t.id),
          admin.from("tasks").select("status, importance, tags").eq("created_by", t.created_by).limit(200),
        ]);

        const tagStats: Record<string, { done: number; elim: number; total: number }> = {};
        let projImpAvg: number | null = null;
        if (history && t.tags) {
          for (const h of history) {
            for (const tag of (h.tags ?? [])) {
              if (!t.tags.includes(tag)) continue;
              tagStats[tag] ||= { done: 0, elim: 0, total: 0 };
              tagStats[tag].total++;
              if (h.status === "completed") tagStats[tag].done++;
              if (h.status === "eliminated") tagStats[tag].elim++;
            }
          }
        }

        const dossier = {
          title: t.title,
          description: t.description,
          tags: t.tags,
          project: proj?.name,
          shared: !!(proj?.team_id || proj?.tenant_id),
          subtask_count: subCount ?? 0,
          attachment_count: attCount ?? 0,
          current_importance: t.importance,
          tag_history: tagStats,
        };

        const ai = await aiImportance(dossier, LOVABLE_API_KEY);
        if (!ai) continue;

        // 3) Create suggestion if importance differs by >=1
        if (Math.abs(ai.importance - (t.importance ?? 3)) >= 1) {
          const suggestedQuadrant = quadrantFor(appliedUrg, ai.importance);
          // dedupe pending
          await admin.from("task_reclassification_suggestions")
            .update({ status: "expired", resolved_at: new Date().toISOString() })
            .eq("task_id", t.id).eq("status", "pending");
          await admin.from("task_reclassification_suggestions").insert({
            task_id: t.id,
            user_id: t.created_by,
            current_quadrant: t.quadrant,
            suggested_quadrant: suggestedQuadrant,
            current_importance: t.importance ?? 3,
            suggested_importance: ai.importance,
            current_urgency: t.urgency ?? 3,
            applied_urgency: appliedUrg,
            reason: ai.reason,
            signals: dossier as any,
          });
          stats.suggestionsCreated++;

          await admin.from("notifications").insert({
            user_id: t.created_by,
            type: "ai_reclassification",
            title: "Sugestão de reclassificação",
            body: `${t.title}: a IA sugere mudar a importância`,
            metadata: { task_id: t.id },
          } as any).then(() => {}).catch(() => {});
        }
      } catch (e) {
        console.error("task error", t.id, e);
        stats.errors++;
      }
    }

    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reevaluate-deadlines error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
