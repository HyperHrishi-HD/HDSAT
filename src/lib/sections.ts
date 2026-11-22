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
  /** A one-word tab label, when the full name would not fit a phone tab. */
  shortLabel?: string;
  icon: IconName;
  /** Exactly-on-this-path matching, for the Dashboard at `/`. */
  end?: boolean;
}

export const SECTIONS: Section[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/practice', label: 'Practice', icon: 'practice' },
  { to: '/test', label: 'Full test', icon: 'test' },
  { to: '/bank', label: 'Question bank', shortLabel: 'Bank', icon: 'bank' },
  { to: '/flashcards', label: 'Flashcards', icon: 'flashcards' },
  { to: '/arcade', label: 'Arcade', icon: 'arcade' },
  { to: '/resources', label: 'Resources', icon: 'resources' },
  { to: '/rewards', label: 'Rewards', icon: 'rewards' },
  { to: '/account', label: 'Account', icon: 'account' },
];

/** Every section except the Dashboard itself — what the Dashboard links to. */
export const DASHBOARD_SECTIONS: Section[] = SECTIONS.filter((section) => section.to !== '/');
