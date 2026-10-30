/**
 * CodeBuddy CLI reads a large number of CODEBUDDY_* switches from its environment and
 * several of them change what the binary does rather than how it authenticates. When the
 * CLI is spawned from a host that already runs CodeBuddy internally (an IDE shell, an
 * agent runtime), those inherited switches leak into the child process:
 *
 *   CODEBUDDY_FORCE_LITE_WB_BUNDLE / CODEBUDDY_FORCE_HEADLESS_BUNDLE
 *     force a reduced bundle that does not implement `--acp`, so the process exits
 *     silently with code 0 and no output at all, which looks exactly like "ACP is
 *     broken" instead of "this process was told to run a different build".
 *   CODEBUDDY_CONFIG_DIR / CODEBUDDY_MCP_CONFIG / CODEBUDDY_BUILTIN_SKILLS_DIR
 *     redirect config, MCP servers and skills to the host's own directories.
 *   SERVER__PORT / SERVER__HOST
 *     make the CLI try to listen on the host's internal port and fail with EADDRINUSE.
 *
 * None of those describe the user's intent for this provider, so they are stripped.
 * Values the user actually typed into the provider settings are always kept, and the
 * two authentication variables stay inheritable because they are harmless and handy.
 */

const STRIPPED_PREFIXES = ['SERVER__', 'CLAUDE_', 'ANTHROPIC_', 'CODEBUDDY_'];

/** Inherited values that remain useful (authentication only, no behaviour switches). */
const INHERITABLE_CODEBUDDY_KEYS = new Set([
  'CODEBUDDY_API_KEY',
  'CODEBUDDY_AUTH_TOKEN',
]);

const CHINA_INTERNET_ENVIRONMENT = 'internal';

function shouldStrip(key: string): boolean {
  if (INHERITABLE_CODEBUDDY_KEYS.has(key)) {
    return false;
  }
  return STRIPPED_PREFIXES.some(prefix => key.startsWith(prefix));
}

export interface PrepareCodebuddyEnvironmentOptions {
  /** Entries the user configured for this provider; always preserved. */
  configuredEnvironment?: NodeJS.ProcessEnv;
}

export function prepareCodebuddyEnvironment(
  env: NodeJS.ProcessEnv,
  options: PrepareCodebuddyEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const configured = options.configuredEnvironment ?? {};
  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (!shouldStrip(key) || Object.prototype.hasOwnProperty.call(configured, key)) {
      next[key] = value;
    }
  }

  // The Chinese deployment rejects requests without this flag, and it is the default
  // audience for this provider, so supply it unless the user asked for something else.
  if (!next.CODEBUDDY_INTERNET_ENVIRONMENT) {
    next.CODEBUDDY_INTERNET_ENVIRONMENT = CHINA_INTERNET_ENVIRONMENT;
  }

  return next;
}
