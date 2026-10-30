import { encodeProviderModelSelectionId } from '@/core/providers/modelSelection';
import { codebuddyChatUIConfig } from '@/providers/codebuddy/ui/CodebuddyChatUIConfig';

describe('codebuddyChatUIConfig', () => {
  const settings = {
    providerConfigs: {
      codebuddy: {
        discoveredModels: [
          { label: 'DeepSeek V4.1 Flash', rawId: 'deepseek-v4.1-flash' },
          { label: 'Hy4 preview', rawId: 'hy4-preview' },
        ],
        visibleModels: ['hy4-preview'],
      },
    },
  };

  it('exposes only discovered visible models to the shared picker', () => {
    expect(codebuddyChatUIConfig.getModelOptions(settings as never)).toEqual([{
      description: 'CodeBuddy ACP model',
      label: 'Hy4 preview',
      value: encodeProviderModelSelectionId('codebuddy', 'hy4-preview'),
    }]);
  });

  it('encodes provider-scoped model ids and claims ownership of them', () => {
    const model = encodeProviderModelSelectionId('codebuddy', 'hy4-preview');
    const bag = settings as unknown as Record<string, unknown>;

    expect(codebuddyChatUIConfig.ownsModel(model, bag)).toBe(true);
    expect(codebuddyChatUIConfig.ownsModel(encodeProviderModelSelectionId('claude', 'haiku'), bag)).toBe(false);
    expect(codebuddyChatUIConfig.getDefaultModel!(bag)).toBe(model);
  });

  it('falls back to effort options when the CLI has not reported thinking levels', () => {
    const model = encodeProviderModelSelectionId('codebuddy', 'hy4-preview');

    expect(codebuddyChatUIConfig.getReasoningOptions!(model, settings as never)).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ]);
    expect(codebuddyChatUIConfig.getDefaultReasoningValue!(model, settings as never)).toBe('high');
  });

  it('prefers thinking levels discovered from the session config', () => {
    const model = encodeProviderModelSelectionId('codebuddy', 'hy4-preview');
    const withLevels = {
      providerConfigs: {
        codebuddy: {
          discoveredModels: [{ label: 'Hy4 preview', rawId: 'hy4-preview' }],
          discoveredThinkingLevels: [{ label: 'High', value: 'high' }],
          visibleModels: ['hy4-preview'],
        },
      },
    };

    expect(codebuddyChatUIConfig.getReasoningOptions!(model, withLevels as never))
      .toEqual([{ label: 'High', value: 'high' }]);
    expect(codebuddyChatUIConfig.getDefaultReasoningValue!(model, withLevels as never)).toBe('high');
  });

  it('maps the permission toggle to the same intents the adapter consumes', () => {
    expect(codebuddyChatUIConfig.getPermissionModeToggle!()).toMatchObject({
      activeValue: 'yolo',
      inactiveValue: 'normal',
      planValue: 'plan',
    });
  });

  it('reports the CLI context window reported by CodeBuddy ACP', () => {
    expect(codebuddyChatUIConfig.getContextWindowSize('hy4-preview')).toBe(960_000);
    expect(codebuddyChatUIConfig.getContextWindowSize('hy4-preview', { 'hy4-preview': 1_000 }))
      .toBe(1_000);
  });
});
