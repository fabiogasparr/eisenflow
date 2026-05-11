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

async function authenticateUser(req: Request) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    throw new Error("Unauthorized");
  }

  const userId = claimsData.claims.sub as string;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  return { userId, supabaseAdmin };
}

async function getTokenAndAccess(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (tokenError || !tokenRow) {
    throw new Error("Google Calendar not connected");
  }

  const accessToken = await refreshTokenIfNeeded(supabaseAdmin, tokenRow);
  const calendarId = tokenRow.calendar_id || "primary";

  return { tokenRow, accessToken, calendarId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, supabaseAdmin } = await authenticateUser(req);
    const { tokenRow, accessToken, calendarId } = await getTokenAndAccess(supabaseAdmin, userId);

    const body = await req.json();
    const { action } = body;

    // ── LIST CALENDARS ──
    if (action === "list-calendars") {
      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/users/me/calendarList`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Google API error [${res.status}]: ${JSON.stringify(data)}`);

      const calendars = (data.items || []).map((cal: Record<string, unknown>) => ({
        id: cal.id,
        summary: cal.summary,
        primary: cal.primary || false,
        backgroundColor: cal.backgroundColor,
      }));

      return new Response(JSON.stringify({ calendars }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const { summary, description, startDateTime, endDateTime, allDay } = body;

      const event: Record<string, unknown> = {
        summary,
        description: description || "",
      };
      if (allDay) {
        const dateStr = new Date(startDateTime).toISOString().slice(0, 10);
        const nextDay = new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000)
          .toISOString().slice(0, 10);
        event.start = { date: dateStr };
        event.end = { date: nextDay };
      } else {
        event.start = { dateTime: startDateTime, timeZone: "America/Sao_Paulo" };
        event.end = {
          dateTime: endDateTime || new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: "America/Sao_Paulo",
        };
      }

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

    // ── IMPORT EVENTS (Google → Tasks) ──
    if (action === "import-events") {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });

      const res = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const eventsData = await res.json();
      if (!res.ok) throw new Error(`Google API error [${res.status}]: ${JSON.stringify(eventsData)}`);

      const events = eventsData.items || [];
      let imported = 0;
      let updated = 0;

      for (const event of events) {
        if (!event.id || !event.summary) continue;
        const startDateTime = event.start?.dateTime || event.start?.date;
        if (!startDateTime) continue;

        // Check if task already exists for this event
        const { data: existingTasks } = await supabaseAdmin
          .from("tasks")
          .select("id, title, description, due_date")
          .eq("google_event_id", event.id)
          .eq("created_by", userId);

        if (existingTasks && existingTasks.length > 0) {
          // Update existing task if Google event changed
          const existing = existingTasks[0];
          const needsUpdate =
            existing.title !== event.summary ||
            existing.description !== (event.description || null) ||
            existing.due_date !== startDateTime;

          if (needsUpdate) {
            await supabaseAdmin
              .from("tasks")
              .update({
                title: event.summary,
                description: event.description || null,
                due_date: startDateTime,
              })
              .eq("id", existing.id);
            updated++;
          }
        } else {
          // Create new task from event
          await supabaseAdmin
            .from("tasks")
            .insert({
              title: event.summary,
              description: event.description || null,
              due_date: startDateTime,
              google_event_id: event.id,
              created_by: userId,
              quadrant: "schedule",
              status: "pending",
            });
          imported++;
        }
      }

      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ success: true, imported, updated, total: events.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SYNC ALL TASKS (Tasks → Google) ──
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
            else await res.text();
          } catch (_e) {
            // skip
          }
        } else {
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
            // skip
          }
        }
      }

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
    const status = (err instanceof Error && err.message === "Unauthorized") ? 401 : 500;
    console.error("google-calendar-sync error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
