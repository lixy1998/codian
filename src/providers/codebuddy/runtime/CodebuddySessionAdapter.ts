import {
  decodeProviderModelSelectionId,
  encodeProviderModelSelectionId,
} from '../../../core/providers/modelSelection';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  AcpClientConnection,
  AcpNewSessionResponse,
  AcpSessionConfigOption,
} from '../../acp';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  flattenAcpSessionConfigSelectOptions,
} from '../../acp';
import type { NativeAcpSessionAdapter } from '../../native-acp/runtime/types';
import {
  CODEBUDDY_PROVIDER_ID,
  getCodebuddyProviderSettings,
  updateCodebuddyProviderSettings,
} from '../settings';

type SessionConfigSource = Pick<AcpNewSessionResponse, 'configOptions' | 'models' | 'modes' | 'sessionId'>;

/**
 * Codian exposes three coarse permission intents (`yolo` / `normal` / `plan`) while ACP
 * reports seven concrete modes. The extra ones stay addressable by passing a raw ACP id
 * through, so a user who wants `fullAccess` or `dontAsk` can still select it explicitly.
 */
const PERMISSION_INTENT_TO_ACP_MODE: Record<string, string> = {
  yolo: 'bypassPermissions',
  normal: 'default',
  plan: 'plan',
};

const ACP_FALLBACK_MODE_ID = 'default';

export class CodebuddySessionAdapter implements NativeAcpSessionAdapter {
  private configOptions: AcpSessionConfigOption[] = [];
  private currentModelId: string | null = null;
  private currentModeId: string | null = null;

  constructor(private readonly plugin: ProviderHost) {}

  async syncSessionConfig(source: SessionConfigSource): Promise<void> {
    this.configOptions = source.configOptions ?? [];
    const modelState = extractAcpSessionModelState(source);
    const modeState = extractAcpSessionModeState(source);
    this.currentModelId = modelState.currentModelId;
    this.currentModeId = modeState.currentModeId;

    const discoveredModels = modelState.availableModels.map(model => ({
      ...(model.description ? { description: model.description } : {}),
      label: model.name,
      rawId: model.id,
    }));
    const availableModes = modeState.availableModes.map(mode => ({
      ...(mode.description ? { description: mode.description } : {}),
      id: mode.id,
      label: mode.name,
    }));
    const discoveredThinkingLevels = this.extractThinkingLevels();

    if (
      discoveredModels.length === 0
      && availableModes.length === 0
      && !discoveredThinkingLevels
    ) {
      return;
    }

    const current = getCodebuddyProviderSettings(this.plugin.settings);
    const visibleModels = current.discoveredModels.length === 0 && current.visibleModels.length === 0
      ? discoveredModels.map(model => model.rawId)
      : current.visibleModels.filter(modelId => discoveredModels.some(model => model.rawId === modelId));

    await this.plugin.mutateSettings((settings) => {
      updateCodebuddyProviderSettings(settings, {
        ...(availableModes.length > 0 ? { availableModes } : {}),
        ...(discoveredModels.length > 0 ? { discoveredModels, visibleModels } : {}),
        // Replace rather than merge: a stale tier left over from an earlier session would
        // stay selectable even though the CLI no longer accepts it.
        ...(discoveredThinkingLevels ? { discoveredThinkingLevels } : {}),
      });
    });
    this.plugin.notifyProviderChatOptionsChanged?.(CODEBUDDY_PROVIDER_ID);
  }

  async applySelections(params: {
    connection: AcpClientConnection;
    model?: string;
    sessionId: string;
  }): Promise<void> {
    await this.applyModel(params);
    await this.applyReasoning(params);
    await this.applyPermissionMode(params);
  }

  async handleConfigOptions(configOptions: AcpSessionConfigOption[], sessionId: string): Promise<void> {
    await this.syncSessionConfig({ configOptions, sessionId });
  }

  private async applyModel(params: {
    connection: AcpClientConnection;
    model?: string;
    sessionId: string;
  }): Promise<void> {
    const modelConfig = this.findSelectConfig('model');
    if (!params.model || !modelConfig) {
      return;
    }
    const options = flattenAcpSessionConfigSelectOptions(modelConfig.options);
    const decoded = decodeProviderModelSelectionId(params.model);
    const targetOption = options.find(option => (
      option.value === params.model
      || option.value === decoded?.modelId
      || (decoded && option.value === encodeProviderModelSelectionId(CODEBUDDY_PROVIDER_ID, decoded.modelId))
    ));
    const targetModelId = targetOption?.value ?? decoded?.modelId ?? params.model;
    if (targetModelId && targetModelId !== this.currentModelId) {
      await this.setConfigOption(params.connection, {
        configId: modelConfig.id,
        sessionId: params.sessionId,
        type: 'select',
        value: targetModelId,
      });
      this.currentModelId = targetModelId;
    }
  }

  private async applyReasoning(params: {
    connection: AcpClientConnection;
    sessionId: string;
  }): Promise<void> {
    const thinking = this.findThinkingConfig();
    if (!thinking) {
      return;
    }

    const requested = typeof this.plugin.settings.effortLevel === 'string'
      ? this.plugin.settings.effortLevel
      : '';

    if (thinking.type === 'boolean') {
      if (requested !== 'on' && requested !== 'off') {
        return;
      }
      await this.setConfigOption(params.connection, {
        configId: thinking.id,
        sessionId: params.sessionId,
        type: 'boolean',
        value: requested === 'on',
      });
      return;
    }

    const options = flattenAcpSessionConfigSelectOptions(thinking.options);
    if (options.length === 0) {
      return;
    }

    const exact = requested ? options.find(option => option.value === requested) : undefined;
    // The CLI can drop a tier between sessions (for example when the active model changes).
    // Fall back to a value it does accept and persist that, so the toolbar never shows a
    // selection the session silently ignored.
    const target = exact ?? options.find(option => option.value === thinking.currentValue) ?? options[0];
    if (!target) {
      return;
    }
    if (!exact) {
      await this.plugin.mutateSettings((settings) => {
        (settings as Record<string, unknown>).effortLevel = target.value;
      });
    }
    if (target.value !== thinking.currentValue) {
      await this.setConfigOption(params.connection, {
        configId: thinking.id,
        sessionId: params.sessionId,
        type: 'select',
        value: target.value,
      });
    }
  }

  private async applyPermissionMode(params: {
    connection: AcpClientConnection;
    sessionId: string;
  }): Promise<void> {
    const modeConfig = this.findSelectConfig('mode');
    if (!modeConfig) {
      return;
    }
    const options = flattenAcpSessionConfigSelectOptions(modeConfig.options);
    const requested = typeof this.plugin.settings.permissionMode === 'string'
      ? this.plugin.settings.permissionMode
      : '';
    const wanted = PERMISSION_INTENT_TO_ACP_MODE[requested] ?? requested ?? ACP_FALLBACK_MODE_ID;
    const target = options.find(option => option.value === wanted)
      ?? options.find(option => option.value === ACP_FALLBACK_MODE_ID);
    if (target && target.value !== this.currentModeId) {
      await this.setConfigOption(params.connection, {
        configId: modeConfig.id,
        sessionId: params.sessionId,
        type: 'select',
        value: target.value,
      });
      this.currentModeId = target.value;
    }
  }

  /**
   * Returns the tiers the session actually accepts, or `null` when the CLI did not report a
   * thinking config at all (leave the stored list untouched in that case, rather than
   * wiping it on a partial update).
   */
  private extractThinkingLevels(): Array<{ label: string; value: string; description?: string }> | null {
    const thinking = this.findThinkingConfig();
    if (!thinking || thinking.type !== 'select') {
      return null;
    }
    return flattenAcpSessionConfigSelectOptions(thinking.options).map(option => ({
      ...(option.description ? { description: option.description } : {}),
      label: option.name,
      value: option.value,
    }));
  }

  private findSelectConfig(
    category: 'model' | 'mode',
  ): Extract<AcpSessionConfigOption, { type: 'select' }> | null {
    const option = this.configOptions.find(candidate => candidate.type === 'select' && (
      candidate.category?.toLowerCase() === category || candidate.id.toLowerCase() === category
    ));
    return option?.type === 'select' ? option : null;
  }

  private findThinkingConfig(): AcpSessionConfigOption | null {
    return this.configOptions.find(option => (
      option.category?.toLowerCase() === 'thought_level'
      || ['thinking', 'thought_level', 'effort'].includes(option.id.toLowerCase())
    )) ?? null;
  }

  private async setConfigOption(
    connection: AcpClientConnection,
    request: Parameters<AcpClientConnection['setConfigOption']>[0],
  ): Promise<void> {
    const response = await connection.setConfigOption(request);
    this.configOptions = response.configOptions;
  }
}
