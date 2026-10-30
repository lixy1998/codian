import {
  DEFAULT_CODEBUDDY_PROVIDER_SETTINGS,
  getCodebuddyProviderSettings,
  updateCodebuddyProviderSettings,
} from '@/providers/codebuddy/settings';

describe('CodeBuddy settings', () => {
  it('ships a disabled provider with no discovered models', () => {
    expect(DEFAULT_CODEBUDDY_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_CODEBUDDY_PROVIDER_SETTINGS.discoveredModels).toEqual([]);
    expect(DEFAULT_CODEBUDDY_PROVIDER_SETTINGS.environmentVariables).toBe('');
  });

  it('defaults newly discovered models to visible when no selection was stored', () => {
    const settings = {
      providerConfigs: {
        codebuddy: {
          discoveredModels: [{ label: 'DeepSeek V4.1 Flash', rawId: 'deepseek-v4.1-flash' }],
        },
      },
    };

    expect(getCodebuddyProviderSettings(settings).visibleModels).toEqual(['deepseek-v4.1-flash']);
  });

  it('preserves an explicit empty visible-model selection', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        codebuddy: {
          discoveredModels: [{ label: 'DeepSeek V4.1 Flash', rawId: 'deepseek-v4.1-flash' }],
          visibleModels: ['deepseek-v4.1-flash'],
        },
      },
    };

    updateCodebuddyProviderSettings(settings, { visibleModels: [] });

    expect(getCodebuddyProviderSettings(settings).visibleModels).toEqual([]);
  });

  it('drops aliases that point at models which are no longer discovered', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        codebuddy: {
          discoveredModels: [{ label: 'Hy3', rawId: 'hy3' }],
          modelAliases: { hy3: 'Hy3 custom', 'gone-model': 'stale' },
        },
      },
    };

    expect(getCodebuddyProviderSettings(settings).modelAliases).toEqual({ hy3: 'Hy3 custom' });
  });

  it('keeps discovered permission modes and thinking levels', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: {
        codebuddy: {
          availableModes: [{ id: 'plan', label: 'Plan' }],
          discoveredThinkingLevels: [{ label: 'High', value: 'high' }],
        },
      },
    };

    const parsed = getCodebuddyProviderSettings(settings);

    expect(parsed.availableModes).toEqual([{ id: 'plan', label: 'Plan' }]);
    expect(parsed.discoveredThinkingLevels).toEqual([{ label: 'High', value: 'high' }]);
  });
});
