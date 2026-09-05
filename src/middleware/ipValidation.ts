/**
 * IP Validation Middleware
 * Enforces IP whitelist policies and detects suspicious activity
 */

import { SupabaseClient } from "@supabase/supabase-js";

interface IPAccessOptions {
  enforceWhitelist?: boolean;
  logAllAccess?: boolean;
  autoBlockThreshold?: number; // Block after N failed attempts
}

/**
 * Extract client IP from request (handles proxies)
 */
export function getClientIP(req: any): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket?.remoteAddress || "unknown";
  return ip;
}

/**
 * Check if IP is allowed for a tenant
 */
export async function isIPAllowed(
  supabase: SupabaseClient,
  tenantId: string,
  ipAddress: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_ip_allowed", {
      p_tenant_id: tenantId,
      p_ip_address: ipAddress,
    });

    if (error) {
      console.error("IP validation check failed:", error);
      // Fail open on error
      return true;
    }

    return data === true;
  } catch (err) {
    console.error("Unexpected error in IP validation:", err);
    return true;
  }
}

/**
 * Log IP access attempt
 */
export async function logIPAccess(
  supabase: SupabaseClient,
  tenantId: string,
  ipAddress: string,
  endpoint: string,
  method: string,
  allowed: boolean,
  reason?: string,
  userAgent?: string
): Promise<void> {
  try {
    await supabase.rpc("log_ip_access", {
      p_tenant_id: tenantId,
      p_ip_address: ipAddress,
      p_endpoint: endpoint,
      p_method: method,
      p_allowed: allowed,
      p_reason: reason || null,
      p_user_agent: userAgent || null,
    });
  } catch (err) {
    // Don't fail request if logging fails
    console.warn("Failed to log IP access:", err);
  }
}

/**
 * Report suspicious IP
 */
export async function reportSuspiciousIP(
  supabase: SupabaseClient,
  ipAddress: string,
  threatLevel: "low" | "medium" | "high" | "critical",
  reason: string
): Promise<void> {
  try {
    await supabase.rpc("report_suspicious_ip", {
      p_ip_address: ipAddress,
      p_threat_level: threatLevel,
      p_reason: reason,
    });
  } catch (err) {
    console.error("Failed to report suspicious IP:", err);
  }
}

/**
 * Add IP to whitelist
 */
export async function addIPToWhitelist(
  supabase: SupabaseClient,
  tenantId: string,
  ipAddress: string,
  description?: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("ip_whitelist")
      .insert({
        tenant_id: tenantId,
        ip_address: ipAddress,
        description,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to add IP to whitelist:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error adding IP to whitelist:", err);
    return false;
  }
}

/**
 * Remove IP from whitelist
 */
export async function removeIPFromWhitelist(
  supabase: SupabaseClient,
  tenantId: string,
  ipAddress: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("ip_whitelist")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("ip_address", ipAddress);

    if (error) {
      console.error("Failed to remove IP from whitelist:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Unexpected error removing IP from whitelist:", err);
    return false;
  }
}

/**
 * Create IP validation middleware
 */
export function createIPValidationMiddleware(
  supabase: SupabaseClient,
  options: IPAccessOptions = {}
) {
  const { enforceWhitelist = true, logAllAccess = true, autoBlockThreshold = 10 } = options;

  return async (req: any, res: any, next: any) => {
    try {
      const ipAddress = getClientIP(req);
      const tenantId = req.headers["x-tenant-id"] || req.user?.tenant_id;

      if (!tenantId) {
        // No tenant context - allow request
        return next();
      }

      // Check if IP is allowed
      const allowed = await isIPAllowed(supabase, tenantId, ipAddress);

      if (!allowed) {
        // Log blocked access
        if (logAllAccess) {
          await logIPAccess(
            supabase,
            tenantId,
            ipAddress,
            req.path || req.url,
            req.method,
            false,
            "IP not in whitelist",
            req.headers["user-agent"]
          );
        }

        return res.status(403).json({
          error: "Forbidden",
          message: "Your IP address is not authorized to access this resource.",
        });
      }

      // Log allowed access
      if (logAllAccess) {
        await logIPAccess(
          supabase,
          tenantId,
          ipAddress,
          req.path || req.url,
          req.method,
          true,
          "IP in whitelist",
          req.headers["user-agent"]
        );
      }

      // Attach IP info to request
      req.clientIP = ipAddress;
      req.ipAllowed = allowed;

      next();
    } catch (error) {
      console.error("IP validation middleware error:", error);
      // Fail open on errors
      next();
    }
  };
}

/**
 * Get access logs for an IP
 */
export async function getIPAccessLogs(
  supabase: SupabaseClient,
  tenantId: string,
  ipAddress: string,
  hoursBack: number = 24,
  limit: number = 100
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from("ip_access_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ip_address", ipAddress)
      .gte("timestamp", new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to get IP access logs:", err);
    return [];
  }
}

/**
 * Get whitelisted IPs for a tenant
 */
export async function getWhitelistedIPs(
  supabase: SupabaseClient,
  tenantId: string
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from("ip_whitelist")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Failed to get whitelisted IPs:", err);
    return [];
  }
}

/**
 * Check for suspicious activity on an IP
 */
export async function checkIPReputation(
  supabase: SupabaseClient,
  ipAddress: string
): Promise<{
  isBlockedExternallyBlacklisted: boolean;
  threatLevel?: "low" | "medium" | "high" | "critical";
  failedAttempts: number;
}> {
  try {
    const { data, error } = await supabase
      .from("suspicious_ips")
      .select("threat_level, failed_attempts, is_blocked, block_until")
      .eq("ip_address", ipAddress)
      .single();

    if (error || !data) {
      return {
        isBlockedExternallyBlacklisted: false,
        failedAttempts: 0,
      };
    }

    const isBlocked = data.is_blocked && (!data.block_until || data.block_until > new Date());

    return {
      isBlockedExternallyBlacklisted: isBlocked,
      threatLevel: data.threat_level,
      failedAttempts: data.failed_attempts,
    };
  } catch (err) {
    console.error("Failed to check IP reputation:", err);
    return {
      isBlockedExternallyBlacklisted: false,
      failedAttempts: 0,
    };
  }
}

/**
 * Validate IP address format
 */
export function isValidIPAddress(ip: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::)$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Get CIDR subnet for an IP (for broader whitelisting)
 */
export function getCIDRSubnet(ipAddress: string, prefixLength: number = 24): string {
  const parts = ipAddress.split(".");
  if (parts.length !== 4) return ipAddress;

  const octets = parts.map((p) => parseInt(p, 10));
  const maskBits = 32 - prefixLength;
  const mask = (0xffffffff << maskBits) >>> 0;

  const subnet = [
    (octets[0] & (mask >> 24)) & 0xff,
    (octets[1] & (mask >> 16)) & 0xff,
    (octets[2] & (mask >> 8)) & 0xff,
    octets[3] & mask & 0xff,
  ];

  return `${subnet.join(".")}/${prefixLength}`;
}
