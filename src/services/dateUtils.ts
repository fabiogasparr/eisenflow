/**
 * Date Utilities with Timezone Support
 *
 * Centralized utilities for handling dates across different timezones.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Format a date using ISO 8601 format
 */
export function toISOString(date: Date): string {
  return date.toISOString();
}

/**
 * Parse an ISO 8601 date string
 */
export function parseISOString(dateString: string): Date {
  return new Date(dateString);
}

/**
 * Get user's timezone from database
 */
export async function getUserTimezone(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("timezone")
      .eq("id", userId)
      .single();

    if (error || !data) {
      return "UTC";
    }

    return data.timezone;
  } catch (err) {
    console.error("Failed to get user timezone:", err);
    return "UTC";
  }
}

/**
 * Convert UTC timestamp to user's timezone (using Supabase function)
 */
export async function convertToUserTimezone(
  supabase: SupabaseClient,
  utcTimestamp: string,
  userId: string
): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc("convert_to_user_timezone", {
      p_timestamp: utcTimestamp,
      p_user_id: userId,
    });

    if (error || !data) {
      throw error || new Error("Failed to convert timestamp");
    }

    return new Date(data);
  } catch (err) {
    console.error("Failed to convert to user timezone:", err);
    return new Date(utcTimestamp);
  }
}

/**
 * Convert local time to UTC (using Supabase function)
 */
export async function convertToUTC(
  supabase: SupabaseClient,
  localTimestamp: string,
  userId: string
): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc("convert_to_utc", {
      p_timestamp: localTimestamp,
      p_user_id: userId,
    });

    if (error || !data) {
      throw error || new Error("Failed to convert timestamp");
    }

    return new Date(data);
  } catch (err) {
    console.error("Failed to convert to UTC:", err);
    return new Date(localTimestamp);
  }
}

/**
 * Get start of day in user's timezone (using Supabase function)
 */
export async function getStartOfDayInUserTz(
  supabase: SupabaseClient,
  date: Date,
  userId: string
): Promise<Date> {
  try {
    const dateString = date.toISOString().split("T")[0];

    const { data, error } = await supabase.rpc("start_of_day_user_tz", {
      p_date: dateString,
      p_user_id: userId,
    });

    if (error || !data) {
      throw error || new Error("Failed to get start of day");
    }

    return new Date(data);
  } catch (err) {
    console.error("Failed to get start of day:", err);
    // Fallback: set local time to midnight
    const fallback = new Date(date);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
}

/**
 * Get end of day in user's timezone (using Supabase function)
 */
export async function getEndOfDayInUserTz(
  supabase: SupabaseClient,
  date: Date,
  userId: string
): Promise<Date> {
  try {
    const dateString = date.toISOString().split("T")[0];

    const { data, error } = await supabase.rpc("end_of_day_user_tz", {
      p_date: dateString,
      p_user_id: userId,
    });

    if (error || !data) {
      throw error || new Error("Failed to get end of day");
    }

    return new Date(data);
  } catch (err) {
    console.error("Failed to get end of day:", err);
    // Fallback: set local time to 23:59:59
    const fallback = new Date(date);
    fallback.setHours(23, 59, 59, 999);
    return fallback;
  }
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add hours to a date
 */
export function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

/**
 * Add minutes to a date
 */
export function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

/**
 * Get the difference between two dates in days
 */
export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((date2.getTime() - date1.getTime()) / oneDay);
}

/**
 * Get the difference between two dates in hours
 */
export function hoursBetween(date1: Date, date2: Date): number {
  return Math.round((date2.getTime() - date1.getTime()) / (60 * 60 * 1000));
}

/**
 * Get the difference between two dates in minutes
 */
export function minutesBetween(date1: Date, date2: Date): number {
  return Math.round((date2.getTime() - date1.getTime()) / (60 * 1000));
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * Check if a date is in the past
 */
export function isPast(date: Date): boolean {
  return date < new Date();
}

/**
 * Check if a date is in the future
 */
export function isFuture(date: Date): boolean {
  return date > new Date();
}

/**
 * Check if two dates are on the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Get the week of the year
 */
export function getWeekOfYear(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/**
 * Get days in a month
 */
export function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Get the start of the week for a given date
 */
export function getStartOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (weekStartsOn === 0 ? 0 : 1);
  return new Date(d.setDate(diff));
}

/**
 * Get the end of the week for a given date
 */
export function getEndOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const startOfWeek = getStartOfWeek(date, weekStartsOn);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return endOfWeek;
}

/**
 * Get the start of the month
 */
export function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the end of the month
 */
export function getEndOfMonth(date: Date): Date {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Get the start of the year
 */
export function getStartOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

/**
 * Get the end of the year
 */
export function getEndOfYear(date: Date): Date {
  const end = new Date(date.getFullYear(), 11, 31);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Format a duration in milliseconds to human readable format
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Check if a date string is valid
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Get the time until a deadline from now
 */
export function getTimeUntilDeadline(deadline: Date): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  isOverdue: boolean;
} {
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  const isOverdue = diff < 0;
  const absDiff = Math.abs(diff);

  return {
    days: Math.floor(absDiff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((absDiff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((absDiff / (1000 * 60)) % 60),
    seconds: Math.floor((absDiff / 1000) % 60),
    total: absDiff,
    isOverdue,
  };
}
