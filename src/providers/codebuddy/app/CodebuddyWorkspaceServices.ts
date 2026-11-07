import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { NativeAcpCliResolver } from '../../native-acp/runtime/NativeAcpCliResolver';
import { CodebuddyVaultSkillRepository } from '../commands/CodebuddyVaultSkillRepository';
import { CODEBUDDY_PROVIDER_ID } from '../settings';
import { createCodebuddySettingsTabRenderer } from '../ui/CodebuddySettingsTab';

const DEFAULT_COMMAND = 'codebuddy';

export const codebuddyWorkspaceRegistration: ProviderWorkspaceRegistration = {
  async initialize({ vaultAdapter }): Promise<ProviderWorkspaceServices> {
    const cliResolver = new NativeAcpCliResolver(CODEBUDDY_PROVIDER_ID, DEFAULT_COMMAND);
    return {
      cliResolver,
      settingsTabRenderer: createCodebuddySettingsTabRenderer(cliResolver),
      tabWarmupPolicy: { resolveMode: () => 'none' },
      // CodeBuddy reads its own `.codebuddy/skills` folder, which the shared-skill list never
      // covered, so its skills were invisible in the workspace settings tab.
      vaultCommandRepository: new CodebuddyVaultSkillRepository(vaultAdapter),
    };
  },
};
