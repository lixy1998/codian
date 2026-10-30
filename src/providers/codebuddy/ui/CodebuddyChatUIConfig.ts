import {
  encodeProviderModelSelectionId,
  isProviderModelSelectionId,
} from '../../../core/providers/modelSelection';
import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CODEBUDDY_PROVIDER_ICON } from '../../../shared/icons';
import { CODEBUDDY_PROVIDER_ID, getCodebuddyProviderSettings } from '../settings';

const DEFAULT_CONTEXT_WINDOW = 960_000;

const CODEBUDDY_PERMISSION_TOGGLE: ProviderPermissionModeToggleConfig = {
  activeLabel: 'Auto',
  activeValue: 'yolo',
  inactiveLabel: 'Safe',
  inactiveValue: 'normal',
  planLabel: 'Plan',
  planValue: 'plan',
};

export const codebuddyChatUIConfig: ProviderChatUIConfig = {
  modelManagement: 'visible-models',
  getModelOptions(settings): ProviderUIOption[] {
    const codebuddySettings = getCodebuddyProviderSettings(settings);
    const visible = new Set(codebuddySettings.visibleModels);
    return codebuddySettings.discoveredModels
      .filter(model => visible.has(model.rawId))
      .map(model => ({
        description: model.description ?? 'CodeBuddy ACP model',
        label: codebuddySettings.modelAliases[model.rawId] ?? model.label,
        value: encodeProviderModelSelectionId(CODEBUDDY_PROVIDER_ID, model.rawId),
      }));
  },
  getDefaultModel(settings): string | null {
    const rawId = getCodebuddyProviderSettings(settings).visibleModels[0];
    return rawId ? encodeProviderModelSelectionId(CODEBUDDY_PROVIDER_ID, rawId) : null;
  },
  ownsModel(model): boolean {
    return isProviderModelSelectionId(CODEBUDDY_PROVIDER_ID, model);
  },
  isAdaptiveReasoningModel(): boolean {
    return true;
  },
  getReasoningOptions(_model, settings) {
    const codebuddySettings = getCodebuddyProviderSettings(settings);
    // CodeBuddy exposes a single session-level `thought_level` switch with exactly two
    // values: `enabled` (use the model default) and `high` (deep reasoning). The richer
    // per-model tiers in `models[]._meta.effortOptions` have no reliable apply channel
    // over ACP, so offering them produced options that silently did nothing. Show only
    // what the CLI will actually accept.
    return codebuddySettings.discoveredThinkingLevels.map(level => ({
      ...(level.description ? { description: level.description } : {}),
      label: level.label,
      value: level.value,
    }));
  },
  getDefaultReasoningValue(_model, settings): string {
    const codebuddySettings = getCodebuddyProviderSettings(settings);
    return codebuddySettings.discoveredThinkingLevels[0]?.value ?? 'enabled';
  },
  getContextWindowSize(model, customLimits): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },
  isDefaultModel(model): boolean {
    return isProviderModelSelectionId(CODEBUDDY_PROVIDER_ID, model);
  },
  applyModelDefaults(model, settings): void {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      (settings as Record<string, unknown>).model = model;
    }
  },
  normalizeModelVariant(model): string {
    return model;
  },
  getCustomModelIds(): Set<string> {
    return new Set();
  },
  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CODEBUDDY_PERMISSION_TOGGLE;
  },
  resolvePermissionMode(settings): string | null {
    return typeof settings.permissionMode === 'string' ? settings.permissionMode : 'normal';
  },
  applyPermissionMode(value, settings): void {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      (settings as Record<string, unknown>).permissionMode = value;
    }
  },
  getModeSelector(): null {
    return null;
  },
  getProviderIcon() {
    return CODEBUDDY_PROVIDER_ICON;
  },
};
