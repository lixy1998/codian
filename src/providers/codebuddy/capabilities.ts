import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Values below are taken from a live CodeBuddy ACP handshake, not from documentation:
 * `initialize` advertises image + embedded context prompts and http/sse MCP transports,
 * `session/new` returns a full model catalogue with effort options plus seven permission
 * modes (including `plan`), and `session/prompt` streams reasoning and message chunks.
 * ACP exposes no rewind or fork primitives, so both stay disabled.
 */
export const CODEBUDDY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'codebuddy',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  reasoningControl: 'effort',
});
