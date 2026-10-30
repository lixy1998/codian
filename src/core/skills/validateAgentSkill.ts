import type { AgentSkillInput } from './AgentSkill';

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const PORTABLE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YAML_RESERVED_NAMES = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']);

export type AgentSkillValidationField = 'name' | 'description' | 'instructions';

export interface AgentSkillValidationOptions {
  /**
   * Creating a package requires a portable name (lowercase ASCII, hyphen separated) so the
   * directory survives copies between platforms and URL-ish contexts. Reading a package that
   * already exists on disk does not: skills authored by other tools routinely use Chinese or
   * other non-ASCII folder names, and rejecting those only hides them from the picker.
   *
   * Defaults to `true` so every creation path keeps the strict rule.
   */
  requirePortableName?: boolean;
}

export class AgentSkillValidationError extends Error {
  constructor(
    readonly field: AgentSkillValidationField,
    message: string,
  ) {
    super(message);
    this.name = 'AgentSkillValidationError';
  }
}

export function validateAgentSkillName(
  name: string,
  options: AgentSkillValidationOptions = {},
): string | null {
  if (!name) {
    return 'Skill name is required';
  }
  if (name.trim() !== name) {
    return 'Skill name cannot start or end with whitespace';
  }
  if (/[\\/]/.test(name)) {
    return 'Skill name cannot contain path separators';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `Skill name must be ${MAX_NAME_LENGTH} characters or fewer`;
  }
  if (options.requirePortableName === false) {
    return null;
  }
  if (!PORTABLE_NAME_PATTERN.test(name)) {
    return 'Skill name must contain lowercase letters or numbers separated by single hyphens';
  }
  if (YAML_RESERVED_NAMES.has(name)) {
    return 'Skill name cannot be a YAML reserved word';
  }
  return null;
}

export function validateAgentSkillInput(
  input: AgentSkillInput,
  options: AgentSkillValidationOptions = {},
): void {
  const nameError = validateAgentSkillName(input.name, options);
  if (nameError) {
    throw new AgentSkillValidationError('name', nameError);
  }

  const description = input.description.trim();
  if (!description) {
    throw new AgentSkillValidationError('description', 'Skill description is required');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new AgentSkillValidationError(
      'description',
      `Skill description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    );
  }

  if (!input.instructions.trim()) {
    throw new AgentSkillValidationError('instructions', 'Skill instructions are required');
  }
}
