/**
 * Utilidades de data com suporte a fuso horário.
 *
 * MIGRAÇÃO: as funções SQL `convert_to_user_timezone`, `convert_to_utc`,
 * `start_of_day_user_tz` e `end_of_day_user_tz` eram RPCs do Postgres e não
 * foram migradas — no Appwrite não existe `rpc()`. A conversão passa a ser
 * feita aqui com `Intl.DateTimeFormat`, que conhece a base de fusos do IANA
 * (inclusive horário de verão). O fuso do usuário continua vindo do banco, da
 * collection `user_preferences` (legível pelo próprio dono).
 */

import { findOne, Query } from '@/integrations/appwrite/database';

/**
 * Formata uma data em ISO 8601
 */
export function toISOString(date: Date): string {
  return date.toISOString();
}

/**
 * Interpreta uma string ISO 8601
 */
export function parseISOString(dateString: string): Date {
  return new Date(dateString);
}

// ---------------------------------------------------------------- fuso horário

/**
 * Deslocamento (em ms) do fuso `timeZone` em relação ao UTC no INSTANTE `date`.
 * É assim que se descobre o offset correto em fusos com horário de verão.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24, // algumas engines devolvem "24" para a meia-noite
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

/** Componentes de "hora de parede" (ano, mês, dia, hora...) sem fuso. */
function wallParts(dateString: string): [number, number, number, number, number, number] {
  const m = dateString.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    return [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  }
  // Sem formato reconhecível: cai para a leitura nativa, em hora local.
  const d = new Date(dateString);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
}

/**
 * Converte uma hora de parede do fuso `timeZone` no instante real (UTC).
 * Equivale ao `timestamp AT TIME ZONE tz` do Postgres.
 * A segunda passada resolve as viradas de horário de verão.
 */
function wallTimeToUtc(
  [y, mo, d, h, mi, s]: [number, number, number, number, number, number],
  timeZone: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = naive - tzOffsetMs(new Date(naive), timeZone);
  ts = naive - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/**
 * Busca o fuso horário do usuário no banco.
 * Antes: SELECT timezone FROM user_preferences WHERE id = userId.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  try {
    const prefs = await findOne('user_preferences', [Query.equal('user_id', userId)]);
    return prefs?.timezone || 'UTC';
  } catch (err) {
    console.error('Failed to get user timezone:', err);
    return 'UTC';
  }
}

/**
 * Converte um instante UTC para o fuso do usuário.
 *
 * ATENÇÃO ao que isso devolve: como o `Date` do JS não carrega fuso, o
 * resultado é um Date cujos componentes UTC (`getUTCHours()` etc.) representam
 * a hora de PAREDE no fuso do usuário — exatamente o que o
 * `convert_to_user_timezone` do Postgres entregava.
 */
export async function convertToUserTimezone(
  utcTimestamp: string,
  userId: string,
): Promise<Date> {
  try {
    const tz = await getUserTimezone(userId);
    const instante = new Date(utcTimestamp);
    return new Date(instante.getTime() + tzOffsetMs(instante, tz));
  } catch (err) {
    console.error('Failed to convert to user timezone:', err);
    return new Date(utcTimestamp);
  }
}

/**
 * Converte uma hora de parede do fuso do usuário para o instante UTC.
 */
export async function convertToUTC(localTimestamp: string, userId: string): Promise<Date> {
  try {
    const tz = await getUserTimezone(userId);
    return wallTimeToUtc(wallParts(localTimestamp), tz);
  } catch (err) {
    console.error('Failed to convert to UTC:', err);
    return new Date(localTimestamp);
  }
}

/**
 * Início do dia (00:00:00) no fuso do usuário, como instante UTC.
 */
export async function getStartOfDayInUserTz(date: Date, userId: string): Promise<Date> {
  try {
    const tz = await getUserTimezone(userId);
    const [y, mo, d] = date.toISOString().split('T')[0].split('-').map(Number);
    return wallTimeToUtc([y, mo, d, 0, 0, 0], tz);
  } catch (err) {
    console.error('Failed to get start of day:', err);
    // Fallback: meia-noite na hora local do navegador
    const fallback = new Date(date);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
}

/**
 * Fim do dia (23:59:59) no fuso do usuário, como instante UTC.
 */
export async function getEndOfDayInUserTz(date: Date, userId: string): Promise<Date> {
  try {
    const tz = await getUserTimezone(userId);
    const [y, mo, d] = date.toISOString().split('T')[0].split('-').map(Number);
    const fim = wallTimeToUtc([y, mo, d, 23, 59, 59], tz);
    return new Date(fim.getTime() + 999);
  } catch (err) {
    console.error('Failed to get end of day:', err);
    // Fallback: 23:59:59 na hora local do navegador
    const fallback = new Date(date);
    fallback.setHours(23, 59, 59, 999);
    return fallback;
  }
}

/**
 * Soma dias a uma data
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Soma horas a uma data
 */
export function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

/**
 * Soma minutos a uma data
 */
export function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

/**
 * Diferença entre duas datas, em dias
 */
export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((date2.getTime() - date1.getTime()) / oneDay);
}

/**
 * Diferença entre duas datas, em horas
 */
export function hoursBetween(date1: Date, date2: Date): number {
  return Math.round((date2.getTime() - date1.getTime()) / (60 * 60 * 1000));
}

/**
 * Diferença entre duas datas, em minutos
 */
export function minutesBetween(date1: Date, date2: Date): number {
  return Math.round((date2.getTime() - date1.getTime()) / (60 * 1000));
}

/**
 * A data é hoje?
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

/**
 * A data está no passado?
 */
export function isPast(date: Date): boolean {
  return date < new Date();
}

/**
 * A data está no futuro?
 */
export function isFuture(date: Date): boolean {
  return date > new Date();
}

/**
 * As duas datas caem no mesmo dia?
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Semana do ano
 */
export function getWeekOfYear(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/**
 * Dias no mês
 */
export function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Início da semana da data informada
 */
export function getStartOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (weekStartsOn === 0 ? 0 : 1);
  return new Date(d.setDate(diff));
}

/**
 * Fim da semana da data informada
 */
export function getEndOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const startOfWeek = getStartOfWeek(date, weekStartsOn);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return endOfWeek;
}

/**
 * Início do mês
 */
export function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Fim do mês
 */
export function getEndOfMonth(date: Date): Date {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Início do ano
 */
export function getStartOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

/**
 * Fim do ano
 */
export function getEndOfYear(date: Date): Date {
  const end = new Date(date.getFullYear(), 11, 31);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Formata uma duração em milissegundos de forma legível
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
 * A string é uma data válida?
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Tempo restante até um prazo, a partir de agora
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
