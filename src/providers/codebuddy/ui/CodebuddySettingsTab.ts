import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import {
  type ProviderModelPickerModel,
  renderProviderModelPicker,
} from '../../../shared/settings/ProviderModelPicker';
import { getHostnameKey } from '../../../utils/env';
import { NativeAcpChatRuntime } from '../../native-acp/runtime/NativeAcpChatRuntime';
import type { NativeAcpCliResolver } from '../../native-acp/runtime/NativeAcpCliResolver';
import { CODEBUDDY_PROVIDER_CAPABILITIES } from '../capabilities';
import { prepareCodebuddyEnvironment } from '../env/prepareCodebuddyEnvironment';
import { CodebuddySessionAdapter } from '../runtime/CodebuddySessionAdapter';
import {
  CODEBUDDY_PROVIDER_ID,
  getCodebuddyProviderSettings,
  updateCodebuddyProviderSettings,
} from '../settings';

const DISPLAY_NAME = 'CodeBuddy';

export function createCodebuddySettingsTabRenderer(
  cliResolver: NativeAcpCliResolver,
): ProviderSettingsTabRenderer {
  return {
    sections: ['provider'],
    render(container, context, section) {
      const show = (target: 'provider') => section === undefined || section === target;
      if (!show('provider')) {
        return;
      }
      const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
      const codebuddySettings = getCodebuddyProviderSettings(settingsBag);

      new Setting(container).setName(t('settings.setup')).setHeading();
      new Setting(container)
        .setName(t('settings.nativeAcp.cliPathName').replace('{provider}', DISPLAY_NAME))
        .setDesc(t('settings.nativeAcp.cliPathDesc').replace('{command}', 'codebuddy'))
        .addText(text => text
          .setPlaceholder(process.platform === 'win32' ? 'codebuddy.cmd' : '/usr/local/bin/codebuddy')
          .setValue(codebuddySettings.cliPathsByHost[getHostnameKey()] ?? '')
          .onChange(async (value) => {
            const cliPathsByHost = { ...getCodebuddyProviderSettings(settingsBag).cliPathsByHost };
            if (value.trim()) {
              cliPathsByHost[getHostnameKey()] = value.trim();
            } else {
              delete cliPathsByHost[getHostnameKey()];
            }
            await context.plugin.mutateSettings(settings => {
              updateCodebuddyProviderSettings(settings, { cliPathsByHost });
            });
            cliResolver.reset();
            await context.plugin.recycleProviderRuntimes?.(CODEBUDDY_PROVIDER_ID);
          }));

      new Setting(container).setName(t('settings.models')).setHeading();
      renderCodebuddyModelPicker(container, context, settingsBag);

      new Setting(container).setName(t('settings.safety')).setHeading();
      new Setting(container)
        .setName(t('settings.nativeAcp.permissionHandlingName'))
        .setDesc(t('settings.nativeAcp.permissionHandlingDesc').replace('{provider}', DISPLAY_NAME));

      new Setting(container).setName(t('settings.environment')).setHeading();
      new Setting(container)
        .setName(t('settings.nativeAcp.environmentName').replace('{provider}', DISPLAY_NAME))
        .setDesc(t('settings.nativeAcp.environmentDesc').replace('{provider}', DISPLAY_NAME))
        .addTextArea(text => text
          .setPlaceholder(t('settings.nativeAcp.environmentPlaceholder'))
          .setValue(codebuddySettings.environmentVariables)
          .onChange(async (value) => {
            await context.plugin.mutateSettings(settings => {
              updateCodebuddyProviderSettings(settings, { environmentVariables: value });
            });
            cliResolver.reset();
            await context.plugin.recycleProviderRuntimes?.(CODEBUDDY_PROVIDER_ID);
          }));
    },
  };
}

function renderCodebuddyModelPicker(
  container: HTMLElement,
  context: Parameters<ProviderSettingsTabRenderer['render']>[1],
  settingsBag: Record<string, unknown>,
): void {
  const getState = () => {
    const current = getCodebuddyProviderSettings(settingsBag);
    return {
      aliases: current.modelAliases,
      discoveredCount: current.discoveredModels.length,
      models: current.discoveredModels.map((model): ProviderModelPickerModel => ({
        ...(model.description ? { description: model.description } : {}),
        id: model.rawId,
        name: model.label,
      })),
      selectedIds: current.visibleModels,
    };
  };

  renderProviderModelPicker({
    container,
    emptyCatalogText: t('settings.providerCatalog.empty', { provider: DISPLAY_NAME }),
    failedCatalogText: t('settings.providerCatalog.failed', { provider: DISPLAY_NAME }),
    getState,
    async loadCatalog() {
      const runtime = new NativeAcpChatRuntime(context.plugin, {
        args: ['--acp'],
        capabilities: CODEBUDDY_PROVIDER_CAPABILITIES,
        defaultCommand: 'codebuddy',
        prepareEnvironment: prepareCodebuddyEnvironment,
        providerId: CODEBUDDY_PROVIDER_ID,
        sessionAdapter: new CodebuddySessionAdapter(context.plugin),
      });
      try {
        const loaded = await runtime.ensureReady({ allowSessionCreation: true });
        if (!loaded) return 'failed';
        return getCodebuddyProviderSettings(settingsBag).discoveredModels.length > 0 ? 'loaded' : 'empty';
      } finally {
        runtime.cleanup();
      }
    },
    loadCatalogOnRender: true,
    loadingCatalogText: t('settings.providerCatalog.loading', { provider: DISPLAY_NAME }),
    modifier: CODEBUDDY_PROVIDER_ID,
    async onAliasesChange(modelAliases) {
      await context.plugin.mutateSettings(settings => {
        updateCodebuddyProviderSettings(settings, { modelAliases });
      });
      context.notifyProviderModelOptionsChanged(CODEBUDDY_PROVIDER_ID);
    },
    async onSelectedIdsChange(visibleModels) {
      await context.plugin.mutateSettings(settings => {
        updateCodebuddyProviderSettings(settings, { visibleModels });
      });
      context.notifyProviderModelOptionsChanged(CODEBUDDY_PROVIDER_ID);
    },
    providerName: DISPLAY_NAME,
  });
}
