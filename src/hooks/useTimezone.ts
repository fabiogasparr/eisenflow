/**
 * Timezone Hook
 *
 * Detects and manages user's timezone for all date/time operations.
 * Automatically syncs with server preferences.
 */

import { useEffect, useState, useCallback } from "react";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import { useUser } from "@supabase/auth-helpers-react";

/**
 * Get browser's detected timezone (Intl API)
 */
export function detectBrowserTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Valid IANA timezone identifiers (subset of common timezones)
 */
export const VALID_TIMEZONES = [
  // Americas
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Adak",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "America/Sao_Paulo",
  "America/Caracas",
  "America/Lima",
  // Europe
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Vienna",
  "Europe/Prague",
  "Europe/Warsaw",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Athens",
  "Europe/Dublin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Zurich",
  // Asia
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Jakarta",
  "Asia/Seoul",
  "Asia/Manila",
  "Asia/Ho_Chi_Minh",
  "Asia/Manila",
  "Asia/Karachi",
  "Asia/Dhaka",
  // Australia/Pacific
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Samoa",
  "UTC",
] as const;

export type Timezone = (typeof VALID_TIMEZONES)[number];

interface UserTimezonePreference {
  timezone: string;
  language: string;
  dateFormat: string;
  timeFormat: "24h" | "12h";
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
}

/**
 * Hook to manage user timezone
 *
 * Usage:
 * ```tsx
 * const { timezone, setTimezone, formatDate, formatTime } = useTimezone();
 * ```
 */
export function useTimezone() {
  const supabase = useSupabaseClient();
  const user = useUser();

  const [timezone, setTimezoneState] = useState<string>(() =>
    typeof window !== "undefined" ? detectBrowserTimezone() : "UTC"
  );
  const [preferences, setPreferences] = useState<UserTimezonePreference | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Load user preferences from database
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const loadPreferences = async () => {
      try {
        setIsLoading(true);

        const { data, error } = await supabase
          .from("user_preferences")
          .select("timezone, language, date_format, time_format, week_starts_on")
          .eq("id", user.id)
          .single();

        if (error && error.code !== "PGRST116") {
          // PGRST116 = not found, which is okay for first-time users
          throw error;
        }

        if (data) {
          setPreferences({
            timezone: data.timezone,
            language: data.language,
            dateFormat: data.date_format,
            timeFormat: data.time_format as "24h" | "12h",
            weekStartsOn: data.week_starts_on as 0 | 1,
          });
          setTimezoneState(data.timezone);
        } else {
          // First time user - save detected timezone
          const detectedTz = detectBrowserTimezone();
          const newPrefs: UserTimezonePreference = {
            timezone: detectedTz,
            language: "en",
            dateFormat: "YYYY-MM-DD",
            timeFormat: "24h",
            weekStartsOn: 0,
          };

          await supabase
            .from("user_preferences")
            .insert({
              id: user.id,
              timezone: detectedTz,
              language: "en",
              date_format: "YYYY-MM-DD",
              time_format: "24h",
              week_starts_on: 0,
            })
            .select()
            .single();

          setPreferences(newPrefs);
          setTimezoneState(detectedTz);
        }

        setError(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error("Failed to load timezone preferences:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadPreferences();
  }, [user, supabase]);

  /**
   * Update timezone in database and state
   */
  const setTimezone = useCallback(
    async (newTimezone: string) => {
      if (!user) {
        throw new Error("User not authenticated");
      }

      try {
        // Validate timezone
        if (!VALID_TIMEZONES.includes(newTimezone as Timezone)) {
          throw new Error(`Invalid timezone: ${newTimezone}`);
        }

        // Update in database
        const { error } = await supabase
          .from("user_preferences")
          .update({ timezone: newTimezone })
          .eq("id", user.id);

        if (error) throw error;

        // Update local state
        setTimezoneState(newTimezone);
        setPreferences((prev) =>
          prev ? { ...prev, timezone: newTimezone } : null
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [user, supabase]
  );

  /**
   * Format a date according to user preferences
   */
  const formatDate = useCallback(
    (date: Date | string, format?: string): string => {
      try {
        const dateObj = typeof date === "string" ? new Date(date) : date;
        const dateFormat = format || preferences?.dateFormat || "YYYY-MM-DD";

        // Simple format replacement (can be expanded with date-fns or similar)
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getDate()).padStart(2, "0");

        return dateFormat
          .replace("YYYY", String(year))
          .replace("MM", month)
          .replace("DD", day)
          .replace("yyyy", String(year))
          .replace("mm", month)
          .replace("dd", day);
      } catch (err) {
        console.error("Failed to format date:", err);
        return String(date);
      }
    },
    [preferences?.dateFormat]
  );

  /**
   * Format a time according to user preferences
   */
  const formatTime = useCallback(
    (date: Date | string, format?: "12h" | "24h"): string => {
      try {
        const dateObj = typeof date === "string" ? new Date(date) : date;
        const timeFormat = format || preferences?.timeFormat || "24h";

        const hours = String(dateObj.getHours()).padStart(2, "0");
        const minutes = String(dateObj.getMinutes()).padStart(2, "0");
        const seconds = String(dateObj.getSeconds()).padStart(2, "0");

        if (timeFormat === "12h") {
          const hour12 = dateObj.getHours() % 12 || 12;
          const ampm = dateObj.getHours() >= 12 ? "PM" : "AM";
          return `${hour12}:${minutes}:${seconds} ${ampm}`;
        }

        return `${hours}:${minutes}:${seconds}`;
      } catch (err) {
        console.error("Failed to format time:", err);
        return String(date);
      }
    },
    [preferences?.timeFormat]
  );

  /**
   * Format date and time together
   */
  const formatDateTime = useCallback(
    (date: Date | string): string => {
      return `${formatDate(date)} ${formatTime(date)}`;
    },
    [formatDate, formatTime]
  );

  /**
   * Convert UTC timestamp to user's timezone
   */
  const toUserTimezone = useCallback(
    (utcDate: Date | string): Date => {
      const dateObj = typeof utcDate === "string" ? new Date(utcDate) : utcDate;

      // Create a formatter using the user's timezone
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const parts = formatter.formatToParts(dateObj);
      const dateMap = new Map(parts.map((p) => [p.type, p.value]));

      return new Date(
        `${dateMap.get("year")}-${dateMap.get("month")}-${dateMap.get("day")}T${dateMap.get("hour")}:${dateMap.get("minute")}:${dateMap.get("second")}`
      );
    },
    [timezone]
  );

  /**
   * Convert user's timezone to UTC
   */
  const toUtcTimezone = useCallback(
    (localDate: Date | string): Date => {
      const dateObj = typeof localDate === "string" ? new Date(localDate) : localDate;

      // Get the offset between UTC and user's timezone
      const utcDate = new Date(dateObj.toLocaleString("en-US", { timeZone: "UTC" }));
      const tzDate = new Date(dateObj.toLocaleString("en-US", { timeZone: timezone }));
      const offset = utcDate.getTime() - tzDate.getTime();

      return new Date(dateObj.getTime() + offset);
    },
    [timezone]
  );

  /**
   * Get current time in user's timezone
   */
  const getNowInUserTz = useCallback((): Date => {
    return toUserTimezone(new Date());
  }, [toUserTimezone]);

  /**
   * Get start of current day in user's timezone
   */
  const getStartOfDayInUserTz = useCallback((): Date => {
    const now = getNowInUserTz();
    now.setHours(0, 0, 0, 0);
    return now;
  }, [getNowInUserTz]);

  /**
   * Get end of current day in user's timezone
   */
  const getEndOfDayInUserTz = useCallback((): Date => {
    const now = getNowInUserTz();
    now.setHours(23, 59, 59, 999);
    return now;
  }, [getNowInUserTz]);

  return {
    timezone,
    setTimezone,
    preferences,
    isLoading,
    error,
    formatDate,
    formatTime,
    formatDateTime,
    toUserTimezone,
    toUtcTimezone,
    getNowInUserTz,
    getStartOfDayInUserTz,
    getEndOfDayInUserTz,
    detectedTimezone: detectBrowserTimezone(),
  };
}

/**
 * Format a relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string, timezone: string = "UTC"): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const now = new Date();

  const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return `${diffInSeconds}s ago`;
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) {
    return `${diffInDays}d ago`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `${diffInMonths}mo ago`;
  }

  const diffInYears = Math.floor(diffInMonths / 12);
  return `${diffInYears}y ago`;
}

/**
 * Provider component for timezone context
 */
export function TimezoneProvider({ children }: { children: React.ReactNode }) {
  // This can be extended to use React Context for global timezone access
  return <>{children}</>;
}
