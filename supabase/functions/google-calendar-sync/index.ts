import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

async function refreshTokenIfNeeded(
  supabaseAdmin: ReturnType<typeof createClient>,
  tokenRow: {
    user_id: string;
    access_token: string;
    refresh_token: string;
    token_expires_at: string;
    calendar_id: string;
  }
) {
  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  const now = Date.now();

  // Refresh if expires in less than 5 minutes
  if (expiresAt - now > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("google_calendar_tokens")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiresAt,
    })
    .eq("user_id", tokenRow.user_id);

  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub as string;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get user's Google tokens
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (tokenError || !tokenRow) {
    return new Response(JSON.stringify({ error: "Google Calendar not connected" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, tokenRow);
    const calendarId = tokenRow.calendar_id || "primary";

    const body = await req.json();
    const { action } = body;

    // ── LIST EVENTS ──
    if (action === "list-events") {
      const { timeMin, timeMax } = body;
      const params = new URLSearchParams({
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });

      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error [${res.status}]: ${JSON.stringify(data)}`);

      return new Response(JSON.stringify({ events: data.items || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE EVENT ──
    if (action === "create-event") {
      const { summary, description, startDateTime, endDateTime } = body;

      const event = {
        summary,
        description: description || "",
        start: { dateTime: startDateTime, timeZone: "America/Sao_Paulo" },
        end: {
          dateTime: endDateTime || new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        },
      };

      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error [${res.status}]: ${JSON.stringify(data)}`);

      // Update last_synced_at
      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);

      return new Response(JSON.stringify({ event: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── UPDATE EVENT ──
    if (action === "update-event") {
      const { eventId, summary, description, startDateTime, endDateTime } = body;

      const event: Record<string, unknown> = {};
      if (summary) event.summary = summary;
      if (description !== undefined) event.description = description;
      if (startDateTime) {
        event.start = { dateTime: startDateTime, timeZone: "America/Sao_Paulo" };
        event.end = {
          dateTime: endDateTime || new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        };
      }

      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error [${res.status}]: ${JSON.stringify(data)}`);

      return new Response(JSON.stringify({ event: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DELETE EVENT ──
    if (action === "delete-event") {
      const { eventId } = body;

      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!res.ok && res.status !== 404) {
        const data = await res.text();
        throw new Error(`Google API error [${res.status}]: ${data}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SYNC ALL TASKS ──
    if (action === "sync-tasks") {
      const { data: tasks, error: tasksError } = await supabaseAdmin
        .from("tasks")
        .select("id, title, description, due_date, google_event_id, status")
        .eq("created_by", userId)
        .not("due_date", "is", null)
        .in("status", ["pending", "in_progress"]);

      if (tasksError) throw new Error(tasksError.message);

      let synced = 0;
      for (const task of tasks || []) {
        const startDateTime = task.due_date;
        const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();

        if (task.google_event_id) {
          // Update existing event
          try {
            const res = await fetch(
              `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${task.google_event_id}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  summary: task.title,
                  description: task.description || "",
                  start: { dateTime: startDateTime, timeZone: "America/Sao_Paulo" },
                  end: { dateTime: endDateTime, timeZone: "America/Sao_Paulo" },
                }),
              }
            );
            if (res.ok) synced++;
            else await res.text(); // consume body
          } catch (_e) {
            // skip failed updates
          }
        } else {
          // Create new event
          try {
            const res = await fetch(
              `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  summary: task.title,
                  description: task.description || "",
                  start: { dateTime: startDateTime, timeZone: "America/Sao_Paulo" },
                  end: { dateTime: endDateTime, timeZone: "America/Sao_Paulo" },
                }),
              }
            );
            const eventData = await res.json();
            if (res.ok && eventData.id) {
              await supabaseAdmin
                .from("tasks")
                .update({ google_event_id: eventData.id })
                .eq("id", task.id);
              synced++;
            }
          } catch (_e) {
            // skip failed creates
          }
        }
      }

      // Update last_synced_at
      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ success: true, synced, total: tasks?.length ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("google-calendar-sync error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
