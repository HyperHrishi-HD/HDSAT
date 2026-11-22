/**
 * The Arcade's exact coin values. Kept in one pure module so the UI, the guest
 * ledger and the cloud RPC all describe the same economy.
 */

export const ARCADE_COINS = {
  /** One HDCoin for an asteroid, two for a silver ship. */
  asteroid: 1,
  ship: 2,
  /** A first-try correct gate/card/break question. A miss pays zero. */
  firstTryQuestion: 3,
  /** Table Talk is one coin for each correct reply. */
  tableCorrect: 1,
  /** A vault coin is always worth one HDCoin. */
  vaultCoin: 1,
} as const;

export function interceptorTargetCoins(kind: 'asteroid' | 'ship' | undefined): number {
  return kind === 'ship' ? ARCADE_COINS.ship : ARCADE_COINS.asteroid;
}

/**
 * The largest amount one arcade event can legitimately pay. A single shot can
 * clear at most five targets (two coins for a ship), so ten is the ceiling; a
 * malformed or tampered event must never become a jackpot.
 */
export const ARCADE_COIN_MAX_EVENT = 10;

/**
 * A legitimate arcade day is generous but bounded. Without this ceiling a
 * client could call the event RPC repeatedly with fresh ids and mint coins even
 * though each individual event is capped at ten.
 */
export const ARCADE_DAILY_COIN_CAP = 120;

export function clampArcadeCoins(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(ARCADE_COIN_MAX_EVENT, Math.floor(amount)));
}

/** Short, player-facing rules for menus and HUDs. */
export const ARCADE_COIN_RULES = [
  'Interceptor: 1 per asteroid, 2 per ship, 3 for a first-try math break.',
  'Table Talk: 1 per correct reply.',
  'Rune Vault: collected coins plus 3 for a first-try gate answer.',
] as const;

export const ARCADE_COIN_RULE = ARCADE_COIN_RULES.join(' ');
