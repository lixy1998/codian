import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { NativeAcpCliResolver } from '../../native-acp/runtime/NativeAcpCliResolver';
import { CODEBUDDY_PROVIDER_ID } from '../settings';
import { createCodebuddySettingsTabRenderer } from '../ui/CodebuddySettingsTab';

const DEFAULT_COMMAND = 'codebuddy';

export const codebuddyWorkspaceRegistration: ProviderWorkspaceRegistration = {
  async initialize(): Promise<ProviderWorkspaceServices> {
    const cliResolver = new NativeAcpCliResolver(CODEBUDDY_PROVIDER_ID, DEFAULT_COMMAND);
    return {
      cliResolver,
      settingsTabRenderer: createCodebuddySettingsTabRenderer(cliResolver),
      tabWarmupPolicy: { resolveMode: () => 'none' },
    };
  },
};
