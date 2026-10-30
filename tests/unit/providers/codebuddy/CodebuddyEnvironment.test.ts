import { prepareCodebuddyEnvironment } from '@/providers/codebuddy/env/prepareCodebuddyEnvironment';

describe('prepareCodebuddyEnvironment', () => {
  it('strips inherited CODEBUDDY_* switches that force a reduced bundle', () => {
    const env = prepareCodebuddyEnvironment({
      CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1',
      CODEBUDDY_FORCE_HEADLESS_BUNDLE: '1',
      CODEBUDDY_BUILTIN_SKILLS_DIR: 'C:/host/skills',
      CODEBUDDY_MCP_CONFIG: '{"mcpServers":{}}',
      CODEBUDDY_CONFIG_DIR: 'C:/host/config',
      PATH: 'C:/bin',
    });

    expect(env).not.toHaveProperty('CODEBUDDY_FORCE_LITE_WB_BUNDLE');
    expect(env).not.toHaveProperty('CODEBUDDY_FORCE_HEADLESS_BUNDLE');
    expect(env).not.toHaveProperty('CODEBUDDY_BUILTIN_SKILLS_DIR');
    expect(env).not.toHaveProperty('CODEBUDDY_MCP_CONFIG');
    expect(env).not.toHaveProperty('CODEBUDDY_CONFIG_DIR');
    expect(env.PATH).toBe('C:/bin');
  });

  it('strips host server and Claude/Anthropic variables', () => {
    const env = prepareCodebuddyEnvironment({
      SERVER__PORT: '49235',
      SERVER__HOST: '127.0.0.1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      ANTHROPIC_API_KEY: 'sk-ant',
    });

    expect(env).not.toHaveProperty('SERVER__PORT');
    expect(env).not.toHaveProperty('SERVER__HOST');
    expect(env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('keeps inherited credentials that only authenticate the CLI', () => {
    const env = prepareCodebuddyEnvironment({
      CODEBUDDY_API_KEY: 'ck-1',
      CODEBUDDY_AUTH_TOKEN: 'jwt',
    });

    expect(env.CODEBUDDY_API_KEY).toBe('ck-1');
    expect(env.CODEBUDDY_AUTH_TOKEN).toBe('jwt');
  });

  it('keeps variables the user configured explicitly for this provider', () => {
    const env = prepareCodebuddyEnvironment(
      { CODEBUDDY_CONFIG_DIR: 'C:/mine', PATH: 'C:/bin' },
      { configuredEnvironment: { CODEBUDDY_CONFIG_DIR: 'C:/mine' } },
    );

    expect(env.CODEBUDDY_CONFIG_DIR).toBe('C:/mine');
  });

  it('defaults the internet environment to the Chinese deployment', () => {
    expect(prepareCodebuddyEnvironment({ PATH: 'C:/bin' }).CODEBUDDY_INTERNET_ENVIRONMENT)
      .toBe('internal');
  });

  it('does not override an internet environment the user chose', () => {
    const env = prepareCodebuddyEnvironment(
      { CODEBUDDY_INTERNET_ENVIRONMENT: 'i18n' },
      { configuredEnvironment: { CODEBUDDY_INTERNET_ENVIRONMENT: 'i18n' } },
    );

    expect(env.CODEBUDDY_INTERNET_ENVIRONMENT).toBe('i18n');
  });
});
