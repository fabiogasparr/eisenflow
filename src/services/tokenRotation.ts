/**
 * Token Rotation Service
 * Implements secure token rotation with expiration and audit logging
 */

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate a token family ID
 * Used to track related tokens across rotations
 */
export function generateTokenFamily(): string {
  return `tf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Initialize token rotation for a user
 * Should be called when tokens are first created
 */
export async function initializeTokenRotation(
  supabase: SupabaseClient,
  userId: string,
  refreshTokenExpiresIn: number = 30 * 24 * 60 * 60 // 30 days in seconds
): Promise<void> {
  try {
    const tokenFamily = generateTokenFamily();
    const expiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000);

    await supabase
      .from("google_calendar_tokens")
      .update({
        token_family: tokenFamily,
        token_generation: 0,
        refresh_token_expires_at: expiresAt.toISOString(),
        is_revoked: false,
      })
      .eq("user_id", userId);

    // Log initialization
    await logTokenRotation(
      supabase,
      userId,
      "refresh",
      "issued",
      tokenFamily,
      0,
      null,
      null,
      "Initial token issued"
    );
  } catch (err) {
    console.error("Failed to initialize token rotation:", err);
    throw err;
  }
}

/**
 * Rotate a refresh token
 * Called when an access token expires and needs refresh
 */
export async function rotateRefreshToken(
  supabase: SupabaseClient,
  userId: string,
  newAccessToken: string,
  accessTokenExpiresIn: number = 3600, // 1 hour in seconds
  newRefreshToken?: string,
  refreshTokenExpiresIn: number = 30 * 24 * 60 * 60 // 30 days
): Promise<boolean> {
  try {
    // Get current token family and generation
    const { data: current, error: getError } = await supabase
      .from("google_calendar_tokens")
      .select("token_family, token_generation, is_revoked")
      .eq("user_id", userId)
      .single();

    if (getError || !current) {
      console.error("Failed to get current token:", getError);
      return false;
    }

    if (current.is_revoked) {
      console.warn("Cannot rotate revoked token");
      await logTokenRotation(
        supabase,
        userId,
        "refresh",
        "revoked",
        current.token_family,
        current.token_generation + 1,
        null,
        null,
        "Token rotation attempted on revoked token"
      );
      return false;
    }

    const newGeneration = current.token_generation + 1;
    const expiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000);
    const accessTokenExpiresAt = new Date(Date.now() + accessTokenExpiresIn * 1000);

    // Update tokens with new generation
    const { error: updateError } = await supabase
      .from("google_calendar_tokens")
      .update({
        access_token_encrypted: newAccessToken,
        refresh_token_encrypted: newRefreshToken || null,
        token_generation: newGeneration,
        refresh_token_expires_at: expiresAt.toISOString(),
        token_expires_at: accessTokenExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update tokens:", updateError);
      return false;
    }

    // Log rotation
    await logTokenRotation(
      supabase,
      userId,
      "refresh",
      "rotated",
      current.token_family,
      newGeneration,
      null,
      null,
      `Token rotated to generation ${newGeneration}`
    );

    return true;
  } catch (err) {
    console.error("Failed to rotate token:", err);
    return false;
  }
}

/**
 * Check if refresh token is expired
 */
export async function isRefreshTokenExpired(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_refresh_token_expired", {
      p_user_id: userId,
    });

    if (error) return false;
    return data === true;
  } catch (err) {
    console.error("Failed to check token expiration:", err);
    return false;
  }
}

/**
 * Revoke all tokens for a user (security breach)
 */
export async function revokeAllTokens(
  supabase: SupabaseClient,
  userId: string,
  reason: string = "User requested revocation"
): Promise<void> {
  try {
    await supabase.rpc("revoke_all_user_tokens", {
      p_user_id: userId,
      p_reason: reason,
    });

    console.log(`All tokens revoked for user ${userId}. Reason: ${reason}`);
  } catch (err) {
    console.error("Failed to revoke all tokens:", err);
    throw err;
  }
}

/**
 * Log token rotation event
 */
export async function logTokenRotation(
  supabase: SupabaseClient,
  userId: string,
  tokenType: "access" | "refresh" | "all",
  action: "issued" | "rotated" | "expired" | "revoked" | "refreshed",
  tokenFamily?: string | null,
  generation?: number | null,
  ipAddress?: string | null,
  userAgent?: string | null,
  reason?: string | null
): Promise<void> {
  try {
    await supabase.rpc("log_token_rotation", {
      p_user_id: userId,
      p_token_type: tokenType,
      p_action: action,
      p_token_family: tokenFamily || null,
      p_generation: generation || null,
      p_ip_address: ipAddress || null,
      p_user_agent: userAgent || null,
      p_reason: reason || null,
    });
  } catch (err) {
    console.warn("Failed to log token rotation:", err);
  }
}

/**
 * Get token rotation history for a user
 */
export async function getTokenRotationHistory(
  supabase: SupabaseClient,
  userId: string,
  hoursBack: number = 168 // 1 week
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from("token_rotation_log")
      .select("*")
      .eq("user_id", userId)
      .gte("timestamp", new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to get token rotation history:", err);
    return [];
  }
}

/**
 * Detect token reuse attack
 */
export async function detectTokenReuseAttack(
  supabase: SupabaseClient,
  sessionId: string,
  ipAddress: string,
  userAgent: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("detect_token_reuse_attack", {
      p_session_id: sessionId,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    });

    if (error) return false;
    return data === true;
  } catch (err) {
    console.error("Failed to detect token reuse:", err);
    return false;
  }
}

/**
 * Create a session token for a user
 */
export async function createSessionToken(
  supabase: SupabaseClient,
  userId: string,
  expiresInSeconds: number = 3600, // 1 hour
  ipAddress?: string,
  userAgent?: string
): Promise<{ session_id: string; token_family: string } | null> {
  try {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tokenFamily = generateTokenFamily();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { data, error } = await supabase
      .from("session_tokens")
      .insert({
        user_id: userId,
        token_family: tokenFamily,
        token_generation: 0,
        session_id: sessionId,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error || !data) throw error;

    return {
      session_id: data.session_id,
      token_family: data.token_family,
    };
  } catch (err) {
    console.error("Failed to create session token:", err);
    return null;
  }
}

/**
 * Revoke a session token
 */
export async function revokeSessionToken(
  supabase: SupabaseClient,
  sessionId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("session_tokens")
      .update({
        is_revoked: true,
        revoked_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error("Failed to revoke session token:", err);
    return false;
  }
}

/**
 * Get active session tokens for a user
 */
export async function getActiveSessionTokens(
  supabase: SupabaseClient,
  userId: string
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from("session_tokens")
      .select("*")
      .eq("user_id", userId)
      .eq("is_revoked", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to get active session tokens:", err);
    return [];
  }
}

/**
 * Cleanup expired tokens (normally done via cron)
 */
export async function cleanupExpiredTokens(supabase: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("cleanup_expired_tokens");

    if (error) throw error;
    return data || 0;
  } catch (err) {
    console.error("Failed to cleanup expired tokens:", err);
    return 0;
  }
}

/**
 * Check if a session token is valid and not expired/revoked
 */
export async function isSessionTokenValid(
  supabase: SupabaseClient,
  sessionId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("session_tokens")
      .select("is_revoked, expires_at")
      .eq("session_id", sessionId)
      .single();

    if (error || !data) return false;

    return !data.is_revoked && new Date(data.expires_at) > new Date();
  } catch (err) {
    console.error("Failed to validate session token:", err);
    return false;
  }
}
