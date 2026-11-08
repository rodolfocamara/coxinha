import type { LibraryMeeting } from './library';

/** Spec 0123: recovery ends in `interrupted`, so a sealed capture asks for nothing. */
export const awaitsRecovery = (m: Pick<LibraryMeeting, 'captureState' | 'needsRecovery'>) =>
  m.captureState === 'recording' || (m.captureState === 'interrupted' && m.needsRecovery !== false);
