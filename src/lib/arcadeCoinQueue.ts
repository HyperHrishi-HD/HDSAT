/**
 * A small durable outbox for exact Arcade coins.
 *
 * The arcade RPC is the only thing that can credit a signed-in bank. If a
 * deploy lands before that SQL function is installed, the player must not lose
 * the coins they just earned and must not see a red error after every pickup.
 * Each entry carries its idempotency key, so a later retry can run any number
 * of times without paying twice.
 */

import { clampArcadeCoins } from './arcadeCoins';

export const ARCADE_COIN_QUEUE_KEY = 'hdsat.arcade.coin-outbox.v1';

export interface PendingArcadeCoins {
  id: string;
  amount: number;
  createdAt: string;
}

export interface PendingArcadeSession {
  id: string;
  questions: number;
  correct: number;
  timeSpentSeconds: number;
  createdAt: string;
}

const SESSION_QUEUE_KEY = 'hdsat.arcade.session-outbox.v1';

function read(): PendingArcadeCoins[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ARCADE_COIN_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is PendingArcadeCoins =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as PendingArcadeCoins).id === 'string' &&
          Number.isFinite((entry as PendingArcadeCoins).amount) &&
          (entry as PendingArcadeCoins).amount > 0
      )
      .slice(-200);
  } catch {
    return [];
  }
}

function write(entries: PendingArcadeCoins[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entries.length === 0) localStorage.removeItem(ARCADE_COIN_QUEUE_KEY);
    else localStorage.setItem(ARCADE_COIN_QUEUE_KEY, JSON.stringify(entries.slice(-200)));
  } catch {
    /* private mode: the current page keeps the notice, the coins wait in memory */
  }
}

export function pendingArcadeCoins(): PendingArcadeCoins[] {
  return read();
}

export function pendingArcadeCoinTotal(): number {
  return read().reduce((sum, entry) => sum + entry.amount, 0);
}

export function queueArcadeCoins(id: string, amount: number): PendingArcadeCoins[] {
  const safe = clampArcadeCoins(amount);
  if (!id || safe <= 0) return read();
  const entries = read();
  if (entries.some((entry) => entry.id === id)) return entries;
  const next = [...entries, { id, amount: safe, createdAt: new Date().toISOString() }].slice(-200);
  write(next);
  return next;
}

export function removeArcadeCoins(id: string): PendingArcadeCoins[] {
  const next = read().filter((entry) => entry.id !== id);
  write(next);
  return next;
}

export function clearArcadeCoinQueue(): void {
  write([]);
}

function readSessions(): PendingArcadeSession[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SESSION_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is PendingArcadeSession =>
          Boolean(entry) &&
          typeof entry === 'object' &&
          typeof (entry as PendingArcadeSession).id === 'string' &&
          Number.isFinite((entry as PendingArcadeSession).questions) &&
          Number((entry as PendingArcadeSession).questions) > 0
      )
      .slice(-100);
  } catch {
    return [];
  }
}

function writeSessions(entries: PendingArcadeSession[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entries.length === 0) localStorage.removeItem(SESSION_QUEUE_KEY);
    else localStorage.setItem(SESSION_QUEUE_KEY, JSON.stringify(entries.slice(-100)));
  } catch {
    /* private mode: the current page keeps the session pending */
  }
}

export function pendingArcadeSessions(): PendingArcadeSession[] {
  return readSessions();
}

export function queueArcadeSession(session: Omit<PendingArcadeSession, 'createdAt'>): void {
  const sessions = readSessions();
  if (sessions.some((entry) => entry.id === session.id)) return;
  writeSessions([
    ...sessions,
    { ...session, createdAt: new Date().toISOString() },
  ].slice(-100));
}

export function removeArcadeSession(id: string): void {
  writeSessions(readSessions().filter((entry) => entry.id !== id));
}
