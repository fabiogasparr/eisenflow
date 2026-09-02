/**
 * Rate Limiting Middleware
 *
 * Implements rate limiting for API endpoints using token bucket algorithm.
 * Provides protection against:
 * - Brute force attacks
 * - Credential stuffing
 * - DDoS attacks
 *
 * Configuration:
 * - Default: 120 requests per minute per API key
 * - IP-based: 600 requests per minute per IP (10 req/sec)
 * - Super admin: Unlimited
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface RateLimitConfig {
  tokensPerMinute: number;
  warningThreshold: number; // Percentage of limit to trigger warning
  blockDurationMinutes: number;
}

interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  resetAfterSeconds: number;
  status: "allowed" | "blocked" | "warning";
  retryAfterSeconds?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  tokensPerMinute: 120,
  warningThreshold: 0.2, // 20% remaining triggers warning
  blockDurationMinutes: 60,
};

/**
 * Get rate limit headers to include in response
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(120),
    "X-RateLimit-Remaining": String(result.tokensRemaining),
    "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + result.resetAfterSeconds),
    ...(result.status === "blocked" && {
      "Retry-After": String(result.retryAfterSeconds || result.resetAfterSeconds),
    }),
  };
}

/**
 * Initialize rate limiting for an API key
 */
export async function initializeRateLimit(
  supabase: SupabaseClient,
  apiKey: string,
  userId?: string,
  tenantId?: string
): Promise<void> {
  const { error } = await supabase
    .from("rate_limit_buckets")
    .insert({
      api_key: apiKey,
      user_id: userId,
      tenant_id: tenantId,
      tokens_remaining: DEFAULT_CONFIG.tokensPerMinute,
      tokens_capacity: DEFAULT_CONFIG.tokensPerMinute,
      refill_rate: 2, // 2 tokens per minute
    })
    .select()
    .single();

  if (error && error.code !== "23505") {
    // 23505 = unique constraint violation (already exists)
    throw new Error(`Failed to initialize rate limit: ${error.message}`);
  }
}

/**
 * Check rate limit for an API key
 * Uses token bucket algorithm via database function
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  apiKey: string,
  tokensNeeded: number = 1,
  ipAddress?: string
): Promise<RateLimitResult> {
  try {
    // Call database function to check and consume tokens
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_api_key: apiKey,
      p_tokens_needed: tokensNeeded,
      p_ip_address: ipAddress || null,
    });

    if (error) {
      console.error("Rate limit check error:", error);
      // Fail open: allow request if rate limit check fails
      return {
        allowed: true,
        tokensRemaining: tokensNeeded,
        resetAfterSeconds: 60,
        status: "allowed",
      };
    }

    if (!data) {
      return {
        allowed: false,
        tokensRemaining: 0,
        resetAfterSeconds: 60,
        status: "blocked",
        retryAfterSeconds: 60,
      };
    }

    return {
      allowed: data[0].allowed,
      tokensRemaining: data[0].tokens_remaining || 0,
      resetAfterSeconds: data[0].reset_after || 60,
      status: data[0].status || "blocked",
      retryAfterSeconds: data[0].reset_after || 60,
    };
  } catch (error) {
    console.error("Unexpected error in checkRateLimit:", error);
    // Fail open on errors
    return {
      allowed: true,
      tokensRemaining: tokensNeeded,
      resetAfterSeconds: 60,
      status: "allowed",
    };
  }
}

/**
 * Log a rate limit event for auditing
 */
export async function logRateLimitEvent(
  supabase: SupabaseClient,
  apiKey: string,
  endpoint: string,
  method: string,
  status: "allowed" | "blocked" | "warning",
  tokensRemaining: number,
  ipAddress?: string,
  userAgent?: string,
  requestId?: string
): Promise<void> {
  try {
    await supabase.rpc("log_rate_limit_event", {
      p_api_key: apiKey,
      p_endpoint: endpoint,
      p_method: method,
      p_status: status,
      p_tokens_remaining: tokensRemaining,
      p_ip_address: ipAddress || null,
      p_user_agent: userAgent || null,
      p_request_id: requestId || null,
    });
  } catch (error) {
    // Don't fail the request if logging fails
    console.warn("Failed to log rate limit event:", error);
  }
}

/**
 * Block an API key
 */
export async function blockApiKey(
  supabase: SupabaseClient,
  apiKey: string,
  reason?: string
): Promise<void> {
  try {
    await supabase.rpc("block_api_key", {
      p_api_key: apiKey,
      p_reason: reason || null,
    });
  } catch (error) {
    console.error("Failed to block API key:", error);
    throw error;
  }
}

/**
 * Block an IP address
 */
export async function blockIpAddress(
  supabase: SupabaseClient,
  ipAddress: string,
  durationMinutes: number = 60
): Promise<void> {
  try {
    await supabase.rpc("block_ip_address", {
      p_ip_address: ipAddress,
      p_duration: `${durationMinutes} minutes`,
    });
  } catch (error) {
    console.error("Failed to block IP address:", error);
    throw error;
  }
}

/**
 * Get rate limit stats for monitoring
 */
export async function getRateLimitStats(
  supabase: SupabaseClient,
  apiKey: string
): Promise<{
  tokensRemaining: number;
  totalRequests: number;
  blockedRequests: number;
  isBlocked: boolean;
  blockReason?: string;
}> {
  try {
    const { data, error } = await supabase
      .from("rate_limit_buckets")
      .select("tokens_remaining, total_requests, blocked_requests, is_blocked, block_reason")
      .eq("api_key", apiKey)
      .single();

    if (error) {
      throw error;
    }

    return {
      tokensRemaining: data.tokens_remaining,
      totalRequests: data.total_requests,
      blockedRequests: data.blocked_requests,
      isBlocked: data.is_blocked,
      blockReason: data.block_reason,
    };
  } catch (error) {
    console.error("Failed to get rate limit stats:", error);
    throw error;
  }
}

/**
 * Get rate limit events for a time period (for monitoring)
 */
export async function getRateLimitEvents(
  supabase: SupabaseClient,
  apiKey: string,
  hoursBack: number = 24,
  status?: "allowed" | "blocked" | "warning"
): Promise<Array<{
  timestamp: string;
  endpoint: string;
  method: string;
  status: string;
  tokensRemaining: number;
  ipAddress?: string;
}>> {
  try {
    let query = supabase
      .from("rate_limit_events")
      .select("timestamp, endpoint, method, status, tokens_remaining, ip_address")
      .eq("api_key", apiKey)
      .gte("timestamp", new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query.limit(1000);

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error("Failed to get rate limit events:", error);
    throw error;
  }
}

/**
 * Express/Fastify compatible middleware for rate limiting
 * Usage: app.use(createRateLimitMiddleware(supabaseClient))
 */
export function createRateLimitMiddleware(supabase: SupabaseClient) {
  return async (req: any, res: any, next: any) => {
    try {
      // Extract API key from headers
      const apiKey = req.headers["x-api-key"] || req.headers.authorization?.split(" ")[1];

      if (!apiKey) {
        // No API key provided - could be public endpoint
        return next();
      }

      // Extract client IP (handle proxies)
      const ipAddress = (
        req.headers["x-forwarded-for"] ||
        req.headers["cf-connecting-ip"] ||
        req.socket?.remoteAddress ||
        "unknown"
      ).split(",")[0].trim();

      const requestId =
        req.headers["x-request-id"] || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Check rate limit
      const result = await checkRateLimit(supabase, apiKey, 1, ipAddress);

      // Set rate limit headers
      const headers = getRateLimitHeaders(result);
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      if (!result.allowed) {
        // Log blocked request
        await logRateLimitEvent(
          supabase,
          apiKey,
          req.path || req.url,
          req.method,
          "blocked",
          result.tokensRemaining,
          ipAddress,
          req.headers["user-agent"],
          requestId
        );

        return res.status(429).json({
          error: "Rate limit exceeded",
          message: "Too many requests. Please try again later.",
          retryAfter: result.retryAfterSeconds,
        });
      }

      // Log allowed request if it's a warning
      if (result.status === "warning") {
        await logRateLimitEvent(
          supabase,
          apiKey,
          req.path || req.url,
          req.method,
          "warning",
          result.tokensRemaining,
          ipAddress,
          req.headers["user-agent"],
          requestId
        );
      }

      // Attach rate limit info to request for logging
      req.rateLimit = {
        ...result,
        requestId,
      };

      next();
    } catch (error) {
      console.error("Rate limit middleware error:", error);
      // Fail open: allow request on error
      next();
    }
  };
}

/**
 * Detect suspicious activity and automatically block if needed
 */
export async function detectAndBlockSuspiciousActivity(
  supabase: SupabaseClient,
  apiKey: string
): Promise<boolean> {
  try {
    const stats = await getRateLimitStats(supabase, apiKey);

    // Block if too many failures in short time
    if (stats.blockedRequests > 10) {
      await blockApiKey(
        supabase,
        apiKey,
        `Too many failed requests: ${stats.blockedRequests} failures`
      );
      return true;
    }

    // Check if high failure rate
    const failureRate = stats.blockedRequests / (stats.totalRequests || 1);
    if (failureRate > 0.5 && stats.totalRequests > 100) {
      await blockApiKey(supabase, apiKey, `High failure rate: ${(failureRate * 100).toFixed(1)}%`);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to detect suspicious activity:", error);
    return false;
  }
}
