import {
  getAvailableLocales,
  getLocale,
  getLocaleDisplayName,
  setLocale,
  t,
} from '@/i18n/i18n';
import type { Locale, TranslationKey } from '@/i18n/types';

describe('i18n', () => {
  // Reset locale to default before each test
  beforeEach(() => {
    setLocale('en');
  });

  describe('t (translate)', () => {
    it('returns translated string for valid key', () => {
      const result = t('common.save' as TranslationKey);
      expect(result).toBe('Save');
    });

    it('returns string with parameter interpolation', () => {
      // Use a key that has placeholders
      const result = t('chat.rewind.notice' as TranslationKey, { count: 2 });
      expect(result).toBe('Rewound: 2 file(s) reverted');
    });

    it('returns key for missing translation in English', () => {
      const result = t('nonexistent.key.here' as TranslationKey);

      expect(result).toBe('nonexistent.key.here');
    });

    it('returns key for a missing translation in another locale', () => {
      setLocale('zh-CN');

      const result = t('nonexistent.key.here' as TranslationKey);

      expect(result).toBe('nonexistent.key.here');
    });

    it('handles nested keys correctly', () => {
      const result = t('settings.userName.name' as TranslationKey);
      expect(result).toBe('What should Codian call you?');
    });

    it('handles deeply nested keys', () => {
      const result = t('settings.userName.desc' as TranslationKey);
      expect(result).toBe('Your name for personalized greetings (leave empty for generic greetings)');
    });

    it('keeps shared skill management help concise', () => {
      expect(t('settings.agentSkills.sharedExpectation' as TranslationKey))
        .toBe(
          'Manage skills shared across all enabled providers in .agents/skills/.',
        );
    });

    it('returns key when value is not a string', () => {
      // Try to access a non-leaf key (object instead of string)
      const result = t('settings' as TranslationKey);

      expect(result).toBe('settings');
    });

    it('replaces placeholders with params', () => {
      // Use a key with {param} placeholders
      const result = t('chat.fork.failed' as TranslationKey, { error: 'Network timeout' });
      expect(result).toBe('Fork failed: Network timeout');
    });

    it('keeps placeholder if param not provided', () => {
      // Use a key with placeholders but don't provide the param
      const result = t('chat.rewind.notice' as TranslationKey, {});
      expect(result).toBe('Rewound: {count} file(s) reverted');
    });
  });

  describe('setLocale', () => {
    it('sets valid locale and returns true', () => {
      const result = setLocale('en');

      expect(result).toBe(true);
      expect(getLocale()).toBe('en');
    });

    it('sets Chinese Simplified locale', () => {
      const result = setLocale('zh-CN');

      expect(result).toBe(true);
      expect(getLocale()).toBe('zh-CN');
    });

    it('returns false for invalid locale and keeps current', () => {
      setLocale('zh-CN');

      const result = setLocale('invalid' as Locale);

      expect(result).toBe(false);
      expect(getLocale()).toBe('zh-CN'); // Should remain unchanged
    });
  });

  describe('getLocale', () => {
    it('returns default locale initially', () => {
      expect(getLocale()).toBe('en');
    });

    it('returns current locale after change', () => {
      setLocale('zh-CN');
      expect(getLocale()).toBe('zh-CN');
    });
  });

  describe('getAvailableLocales', () => {
    it('returns all supported locales', () => {
      const locales = getAvailableLocales();

      expect(locales).toContain('en');
      expect(locales).toContain('zh-CN');
    });

    it('returns only the bundled locales', () => {
      const locales = getAvailableLocales();
      expect(locales).toHaveLength(2);
    });
  });

  describe('getLocaleDisplayName', () => {
    it('returns English for en', () => {
      expect(getLocaleDisplayName('en')).toBe('English');
    });

    it('returns Simplified Chinese name for zh-CN', () => {
      expect(getLocaleDisplayName('zh-CN')).toBe('简体中文');
    });

    it('returns locale code for unknown locale', () => {
      expect(getLocaleDisplayName('xx' as Locale)).toBe('xx');
    });
  });

  describe('translation in different locales', () => {
    it('translates correctly in Simplified Chinese', () => {
      setLocale('zh-CN');
      const result = t('common.save' as TranslationKey);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
