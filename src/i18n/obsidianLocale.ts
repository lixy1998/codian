import { moment } from 'obsidian';

import { setLocale } from './i18n';
import type { Locale } from './types';

/**
 * Codian ships English + Simplified Chinese only. Obsidian languages outside
 * this map fall back to English; Traditional Chinese maps to the Simplified
 * dictionary so those users still get Chinese copy rather than English.
 */
const OBSIDIAN_LOCALE_MAP: Readonly<Record<string, Locale>> = {
  en: 'en',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-CN',
};

export function resolveObsidianLocale(language: string): Locale {
  const normalized = language.trim().replaceAll('_', '-').toLowerCase();
  return OBSIDIAN_LOCALE_MAP[normalized] ?? 'en';
}

export function syncLocaleWithObsidian(): Locale {
  const locale = resolveObsidianLocale(moment.locale());
  setLocale(locale);
  return locale;
}
