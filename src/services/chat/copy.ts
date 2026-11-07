import i18n from 'i18next';
import type { TFunction } from 'i18next';

/**
 * Translation for code that runs outside React (sessions, backends). Falls back to the
 * key while i18next is not initialised so unit tests need no setup.
 */
export const chatT = ((key: string, options?: Record<string, unknown>) =>
  i18n.isInitialized ? i18n.t(key, options) : key) as TFunction;
