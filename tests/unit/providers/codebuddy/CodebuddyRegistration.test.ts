import { BUILT_IN_PROVIDER_MODULES } from '@/providers';
import { codebuddyProviderRegistration } from '@/providers/codebuddy/registration';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

describe('CodeBuddy provider registration', () => {
  it('registers as a built-in provider with the ACP launch arguments', () => {
    expect(BUILT_IN_PROVIDER_MODULES).toContain(codebuddyProviderRegistration);
    expect(codebuddyProviderRegistration.id).toBe('codebuddy');
    expect(codebuddyProviderRegistration.displayName).toBe('CodeBuddy');
  });

  it('ships default settings so the provider can be enabled before discovery', () => {
    expect(getBuiltInProviderDefaultConfigs()).toHaveProperty('codebuddy');
  });

  it('declares capabilities observed from a live ACP handshake', () => {
    expect(codebuddyProviderRegistration.capabilities).toMatchObject({
      providerId: 'codebuddy',
      reasoningControl: 'effort',
      supportsImageAttachments: true,
      supportsMcpTools: true,
      supportsPlanMode: true,
      supportsProviderCommands: true,
      supportsRewind: false,
      supportsFork: false,
    });
  });

  it('exposes a workspace registration and a chat UI config', () => {
    expect(codebuddyProviderRegistration.workspace).toBeDefined();
    expect(codebuddyProviderRegistration.chatUIConfig).toBeDefined();
  });
});
