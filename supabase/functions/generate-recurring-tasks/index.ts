import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find completed/eliminated tasks with a recurrence rule
    const { data: tasks, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .not("recurrence_rule", "is", null)
      .in("status", ["completed", "eliminated"]);

    if (fetchError) throw fetchError;

    let created = 0;

    for (const task of tasks ?? []) {
      // Check if a pending child already exists for this parent
      const parentId = task.id;
      const { data: existing } = await supabase
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", parentId)
        .eq("status", "pending")
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Calculate next due_date
      let nextDueDate: string | null = null;
      if (task.due_date) {
        const base = new Date(task.due_date);
        switch (task.recurrence_rule) {
          case "daily":
            base.setDate(base.getDate() + 1);
            break;
          case "weekly":
            base.setDate(base.getDate() + 7);
            break;
          case "monthly":
            base.setMonth(base.getMonth() + 1);
            break;
        }
        nextDueDate = base.toISOString();
      }

      const { error: insertError } = await supabase.from("tasks").insert({
        title: task.title,
        description: task.description,
        quadrant: task.quadrant,
        urgency: task.urgency,
        importance: task.importance,
        tags: task.tags,
        estimated_time: task.estimated_time,
        project_id: task.project_id,
        created_by: task.created_by,
        assigned_to: task.assigned_to,
        recurrence_rule: task.recurrence_rule,
        recurrence_parent_id: parentId,
        due_date: nextDueDate,
        status: "pending",
        position: 0,
      });

      if (!insertError) created++;
    }

    return new Response(JSON.stringify({ created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
