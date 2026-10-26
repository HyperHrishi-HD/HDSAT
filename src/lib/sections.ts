import type { IconName } from '../components/ui';

/**
 * The app's sections, in one place.
 *
 * The sidebar, the phone's tab bar and the Dashboard's section list all read
 * from here, so a section can never exist in one of them and be missing from
 * another. Order is the reading order: study first, then the reference shelves,
 * then the rewards and the account.
 */
export interface Section {
  to: string;
  label: string;
  icon: IconName;
  /** Exactly-on-this-path matching, for the Dashboard at `/`. */
  end?: boolean;
}

export const SECTIONS: Section[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/practice', label: 'Practice', icon: 'practice' },
  { to: '/test', label: 'Full test', icon: 'test' },
  { to: '/bank', label: 'Question bank', icon: 'bank' },
  { to: '/flashcards', label: 'Flashcards', icon: 'flashcards' },
  { to: '/arcade', label: 'Arcade', icon: 'arcade' },
  { to: '/resources', label: 'Resources', icon: 'resources' },
  { to: '/rewards', label: 'Rewards', icon: 'rewards' },
  { to: '/account', label: 'Account', icon: 'account' },
];

/**
 * The phone's bottom bar, which carries only the five places a student moves
 * between in a study session. Everything else stays one tap away in the
 * Dashboard's section list, and the Account page has its own door in the top
 * bar. `MOBILE_TABS` is paths, in bar order, not the order of `SECTIONS`.
 */
const MOBILE_TABS = ['/', '/practice', '/test', '/bank', '/rewards'];

export const MOBILE_NAV: Section[] = MOBILE_TABS.map(
  (path) => SECTIONS.find((section) => section.to === path) as Section
);

/** Every section except the Dashboard itself — what the Dashboard links to. */
export const DASHBOARD_SECTIONS: Section[] = SECTIONS.filter((section) => section.to !== '/');
