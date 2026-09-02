import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function styledPage(title: string, subtitle: string, success: boolean, postMessage = false) {
  const icon = success
    ? `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  const script = postMessage
    ? `<script>if(window.opener){window.opener.postMessage({type:'google-calendar-connected'},'*')}setTimeout(function(){window.close()},2000);</script>`
    : `<script>setTimeout(function(){window.close()},3000);</script>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<div style="text-align:center;padding:2rem;">
${icon}
<h1 style="margin:1.5rem 0 .5rem;font-size:1.5rem;color:#1e293b;">${title}</h1>
<p style="color:#64748b;font-size:1rem;">${subtitle}</p>
</div>${script}</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "Google OAuth credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // The redirect URI points back to this edge function's callback
  const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback`;

  try {
    // ── AUTHORIZE ──
    if (action === "authorize") {
      const state = url.searchParams.get("state"); // JWT token passed as state
      if (!state) {
        return new Response(JSON.stringify({ error: "Missing state (auth token)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/userinfo.email",
      ].join(" ");

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scopes);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);

      return Response.redirect(authUrl.toString(), 302);
    }

    // ── CALLBACK ──
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state"); // JWT token
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
      return new Response(styledPage('Autorização cancelada', 'Pode fechar esta aba.', false), { headers: { "Content-Type": "text/html" } });
      }

      if (!code || !state) {
        return new Response(JSON.stringify({ error: "Missing code or state" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify user from state (JWT)
      const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${state}` } },
      });
      const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(state);
      if (claimsError || !claimsData?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Invalid auth token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userId = claimsData.claims.sub as string;

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error("Token exchange failed:", tokenData);
        return new Response(styledPage('Erro ao conectar', 'Tente novamente.', false), { headers: { "Content-Type": "text/html" } });
      }

      // Get user's Google email
      let googleEmail: string | null = null;
      try {
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userInfo = await userInfoRes.json();
        googleEmail = userInfo.email ?? null;
      } catch (_e) {
        // non-critical
      }

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      // Save tokens using service role (to bypass RLS for upsert)
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Get encryption key from Supabase Vault
      // For now, use the SERVICE_ROLE_KEY as fallback (this should be migrated to use vault.get_secret)
      const encryptionKey = Deno.env.get("GOOGLE_TOKENS_ENCRYPTION_KEY") || "FALLBACK_KEY_INSECURE";

      // Encrypt tokens before storage
      // In production, tokens should NEVER be stored in plain text
      let accessTokenEncrypted: string | null = null;
      let refreshTokenEncrypted: string | null = null;
      let encryptionMethod: "vault" | "none" = "none";

      if (encryptionKey && encryptionKey !== "FALLBACK_KEY_INSECURE") {
        // Perform encryption using pgcrypto in database
        const { data: encryptedAccess, error: encError1 } = await supabaseAdmin.rpc(
          "encrypt_token",
          {
            token_value: tokenData.access_token,
            master_key: encryptionKey,
          }
        );

        const { data: encryptedRefresh, error: encError2 } = await supabaseAdmin.rpc(
          "encrypt_token",
          {
            token_value: tokenData.refresh_token,
            master_key: encryptionKey,
          }
        );

        if (!encError1 && !encError2) {
          accessTokenEncrypted = encryptedAccess;
          refreshTokenEncrypted = encryptedRefresh;
          encryptionMethod = "vault";
        }
      }

      const { error: upsertError } = await supabaseAdmin
        .from("google_calendar_tokens")
        .upsert(
          {
            user_id: userId,
            // Legacy plain text columns (deprecated)
            access_token: encryptionMethod === "vault" ? null : tokenData.access_token,
            refresh_token: encryptionMethod === "vault" ? null : tokenData.refresh_token,
            // New encrypted columns
            access_token_encrypted: accessTokenEncrypted,
            refresh_token_encrypted: refreshTokenEncrypted,
            encryption_method: encryptionMethod,
            token_expires_at: expiresAt,
            google_email: googleEmail,
          },
          { onConflict: "user_id" }
        );

      if (upsertError) {
        console.error("Upsert error:", upsertError);
        return new Response(styledPage('Erro ao salvar tokens', 'Tente novamente.', false), { headers: { "Content-Type": "text/html" } });
      }

      // Success - close popup window and notify parent
      return new Response(
        styledPage('Google Calendar conectado!', 'Esta janela será fechada automaticamente...', true, true),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // ── DISCONNECT ──
    if (req.method === "POST") {
      const body = await req.json();
      if (body.action === "disconnect") {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const token = authHeader.replace("Bearer ", "");
        const { data: cd, error: ce } = await supabase.auth.getClaims(token);
        if (ce || !cd?.claims?.sub) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const userId = cd.claims.sub as string;

        // Also clear google_event_id from user's tasks
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabaseAdmin
          .from("tasks")
          .update({ google_event_id: null })
          .eq("created_by", userId);

        const { error: delError } = await supabase
          .from("google_calendar_tokens")
          .delete()
          .eq("user_id", userId);

        if (delError) {
          return new Response(JSON.stringify({ error: delError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("google-calendar-auth error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
