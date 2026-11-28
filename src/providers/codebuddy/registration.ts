import { createNativeAcpProviderModule } from '../native-acp/createNativeAcpProviderModule';
import { codebuddyWorkspaceRegistration } from './app/CodebuddyWorkspaceServices';
import { CODEBUDDY_PROVIDER_CAPABILITIES } from './capabilities';
import { prepareCodebuddyEnvironment } from './env/prepareCodebuddyEnvironment';
import { CodebuddyConversationHistoryService } from './history/CodebuddyConversationHistoryService';
import { CodebuddySessionAdapter } from './runtime/CodebuddySessionAdapter';
import { codebuddyChatUIConfig } from './ui/CodebuddyChatUIConfig';

/**
 * CodeBuddy speaks the same Agent Client Protocol as the other ACP providers, so the
 * provider is a thin configuration of the shared native-ACP module. Two things are
 * CodeBuddy specific and worth keeping in mind:
 *
 * - `--acp` is required: without it the CLI starts an interactive session instead of a
 *   JSON-RPC stream.
 * - The environment must be sanitized. CodeBuddy reads dozens of CODEBUDDY_* switches
 *   that change which bundle it runs; inherited leftovers from an IDE or agent host
 *   disable ACP entirely and the process exits with code 0 and no output.
 */
const nativeCodebuddyProviderRegistration = createNativeAcpProviderModule({
  args: ['--acp'],
  buildExtraArgs: plugin => {
    // ACP has no field for a system prompt, and CodeBuddy's own `CODEBUDDY.md` already covers the
    // repo-level rules. Append the user's custom prompt on the command line so the plugin's
    // "custom system prompt" setting reaches this provider instead of being silently dropped.
    const customPrompt = plugin.settings.systemPrompt?.trim();
    return customPrompt ? ['--append-system-prompt', customPrompt] : [];
  },
  capabilities: CODEBUDDY_PROVIDER_CAPABILITIES,
  chatUIConfig: codebuddyChatUIConfig,
  createSessionAdapter: plugin => new CodebuddySessionAdapter(plugin),
  defaultCommand: 'codebuddy',
  displayName: 'CodeBuddy',
  displayOrder: 45,
  environmentKeyPatterns: [/^CODEBUDDY_/i],
  id: 'codebuddy',
  prepareEnvironment: prepareCodebuddyEnvironment,
});

export const codebuddyProviderRegistration = {
  ...nativeCodebuddyProviderRegistration,
  // Codian stores only metadata; without this the provider transcript is never read back and a
  // restored conversation opens empty. Every other provider registers one. — CodeBuddy included.
  historyService: new CodebuddyConversationHistoryService(),
  workspace: codebuddyWorkspaceRegistration,
};
