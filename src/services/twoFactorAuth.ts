/**
 * Two-Factor Authentication Service
 * Implements TOTP-based 2FA with backup codes
 */

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Generate a random TOTP secret (base32 encoded)
 * In production, use a library like 'speakeasy' or 'otplib'
 */
export function generateTOTPSecret(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}

/**
 * Generate backup codes
 * 10 codes of 8 alphanumeric characters each
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Verify a TOTP code (6 digits)
 * In production, use library that handles time-window tolerance
 */
export function verifyTOTPCode(secret: string, code: string): boolean {
  // This is a placeholder - real implementation should:
  // 1. Use speakeasy or otplib library
  // 2. Check within 30-second time window (allow ±1 window)
  // 3. Prevent code reuse
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  // Real verification would compute HMAC-SHA1 of current time with secret
  // and compare with provided code
  return true; // Placeholder
}

/**
 * Create TOTP provisioning URI for QR code generation
 * Format: otpauth://totp/Example:user@example.com?secret=...&issuer=Example
 */
export function generateTOTPProvisioningURI(
  secret: string,
  email: string,
  issuer: string = "EisenFlow"
): string {
  const encodedEmail = encodeURIComponent(email);
  const encodedIssuer = encodeURIComponent(issuer);

  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&digits=6&period=30`;
}

/**
 * Setup 2FA for a user
 */
export async function setupUserTwoFA(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  secret: string;
  provisioning_uri: string;
  backup_codes: string[];
}> {
  try {
    // Generate secret and backup codes
    const secret = generateTOTPSecret();
    const backupCodes = generateBackupCodes(10);

    // Get user email for provisioning URI
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);

    if (userError || !userData.user?.email) {
      throw new Error("Failed to get user email");
    }

    const provisioningURI = generateTOTPProvisioningURI(secret, userData.user.email);

    // Store (unverified) secret and backup codes in database
    const { error: insertError } = await supabase
      .from("user_2fa")
      .upsert({
        user_id: userId,
        totp_secret: secret,
        backup_codes: backupCodes,
        is_enabled: false, // Not enabled until verified
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return {
      secret,
      provisioning_uri: provisioningURI,
      backup_codes: backupCodes,
    };
  } catch (err) {
    console.error("Failed to setup 2FA:", err);
    throw err;
  }
}

/**
 * Verify and enable 2FA for a user
 */
export async function verifyAndEnable2FA(
  supabase: SupabaseClient,
  userId: string,
  totpCode: string
): Promise<boolean> {
  try {
    // Get the pending 2FA setup
    const { data: twoFA, error: getError } = await supabase
      .from("user_2fa")
      .select("totp_secret")
      .eq("user_id", userId)
      .eq("is_enabled", false)
      .single();

    if (getError || !twoFA?.totp_secret) {
      throw new Error("No pending 2FA setup found");
    }

    // Verify TOTP code
    if (!verifyTOTPCode(twoFA.totp_secret, totpCode)) {
      await logFailed2FAAttempt(supabase, userId);
      return false;
    }

    // Enable 2FA
    const { error: updateError } = await supabase
      .from("user_2fa")
      .update({
        is_enabled: true,
        setup_verified_at: new Date().toISOString(),
        enabled_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    return true;
  } catch (err) {
    console.error("Failed to verify 2FA:", err);
    return false;
  }
}

/**
 * Validate TOTP code for login
 */
export async function validateTOTPCode(
  supabase: SupabaseClient,
  userId: string,
  totpCode: string
): Promise<boolean> {
  try {
    // Get user's 2FA settings
    const { data: twoFA, error: getError } = await supabase
      .from("user_2fa")
      .select("totp_secret, is_enabled")
      .eq("user_id", userId)
      .single();

    if (getError || !twoFA?.is_enabled) {
      return false;
    }

    // Verify TOTP code
    if (!verifyTOTPCode(twoFA.totp_secret, totpCode)) {
      await logFailed2FAAttempt(supabase, userId);
      return false;
    }

    // Update last used
    await supabase
      .from("user_2fa")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId);

    return true;
  } catch (err) {
    console.error("Failed to validate TOTP code:", err);
    return false;
  }
}

/**
 * Use a backup code for login
 */
export async function useBackupCode(
  supabase: SupabaseClient,
  userId: string,
  backupCode: string
): Promise<boolean> {
  try {
    // Get user's 2FA settings
    const { data: twoFA, error: getError } = await supabase
      .from("user_2fa")
      .select("backup_codes, is_enabled")
      .eq("user_id", userId)
      .single();

    if (getError || !twoFA?.is_enabled) {
      return false;
    }

    const codes = twoFA.backup_codes || [];
    const codeIndex = codes.indexOf(backupCode);

    if (codeIndex === -1) {
      await logFailed2FAAttempt(supabase, userId);
      return false;
    }

    // Remove used code
    codes.splice(codeIndex, 1);

    const { error: updateError } = await supabase
      .from("user_2fa")
      .update({
        backup_codes: codes,
        last_used_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) throw updateError;

    return true;
  } catch (err) {
    console.error("Failed to use backup code:", err);
    return false;
  }
}

/**
 * Disable 2FA for a user
 */
export async function disable2FA(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("user_2fa")
      .update({
        is_enabled: false,
        totp_secret: null,
        totp_secret_encrypted: null,
        backup_codes: [],
        backup_codes_encrypted: null,
      })
      .eq("user_id", userId);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error("Failed to disable 2FA:", err);
    return false;
  }
}

/**
 * Check if user has 2FA enabled
 */
export async function is2FAEnabled(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_2fa")
      .select("is_enabled")
      .eq("user_id", userId)
      .single();

    if (error) return false;
    return data?.is_enabled || false;
  } catch {
    return false;
  }
}

/**
 * Log failed 2FA attempt
 */
export async function logFailed2FAAttempt(
  supabase: SupabaseClient,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    await supabase.rpc("log_failed_2fa_attempt", {
      p_user_id: userId,
      p_ip_address: ipAddress || null,
      p_user_agent: userAgent || null,
    });
  } catch (err) {
    console.warn("Failed to log 2FA attempt:", err);
  }
}

/**
 * Get number of failed 2FA attempts
 */
export async function getFailedAttempts(
  supabase: SupabaseClient,
  userId: string,
  minutesBack: number = 30
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("get_failed_2fa_attempts", {
      p_user_id: userId,
      p_minutes_back: minutesBack,
    });

    if (error) return 0;
    return data || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if user should be blocked due to too many failed attempts
 */
export async function shouldBlockUser(
  supabase: SupabaseClient,
  userId: string,
  maxAttempts: number = 5
): Promise<boolean> {
  const attempts = await getFailedAttempts(supabase, userId, 30);
  return attempts >= maxAttempts;
}

/**
 * Generate new backup codes for a user
 */
export async function regenerateBackupCodes(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  try {
    const newCodes = generateBackupCodes(10);

    const { error } = await supabase
      .from("user_2fa")
      .update({
        backup_codes: newCodes,
      })
      .eq("user_id", userId);

    if (error) throw error;
    return newCodes;
  } catch (err) {
    console.error("Failed to regenerate backup codes:", err);
    throw err;
  }
}
