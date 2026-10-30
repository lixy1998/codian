import { parseYaml, stringifyYaml } from 'obsidian';

import type { AgentSkillInput } from './AgentSkill';
import {
  AgentSkillValidationError,
  type AgentSkillValidationOptions,
  validateAgentSkillInput,
} from './validateAgentSkill';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/;

export interface ParsedAgentSkill {
  name: string;
  description: string;
  instructions: string;
  frontmatter: Record<string, unknown>;
}

export interface AgentSkillCodecOptions extends AgentSkillValidationOptions {
  /**
   * The containing folder is the identity of an existing package. Third-party installers
   * routinely leave a stale or differently-cased `name` in the frontmatter; refusing to read
   * those hides skills that work fine. Creating a package still requires an exact match.
   */
  allowDirectoryNameMismatch?: boolean;
}

export class AgentSkillCodecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentSkillCodecError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFrontmatter(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new AgentSkillCodecError('SKILL.md contains invalid YAML frontmatter', { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new AgentSkillCodecError('SKILL.md frontmatter must be a YAML mapping');
  }
  return parsed;
}

export function parseAgentSkillMarkdown(
  content: string,
  directoryName: string,
  options: AgentSkillCodecOptions = {},
): ParsedAgentSkill {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    throw new AgentSkillCodecError('SKILL.md must start with YAML frontmatter');
  }

  const frontmatter = parseFrontmatter(match[1]);
  if (typeof frontmatter.name !== 'string') {
    throw new AgentSkillCodecError('SKILL.md frontmatter requires a string name');
  }
  if (typeof frontmatter.description !== 'string') {
    throw new AgentSkillCodecError('SKILL.md frontmatter requires a string description');
  }
  if (frontmatter.name !== directoryName && !options.allowDirectoryNameMismatch) {
    throw new AgentSkillCodecError('SKILL.md name must match its containing directory');
  }

  const parsed: ParsedAgentSkill = {
    // When the frontmatter name is stale, the folder wins: every later read/write is keyed by
    // the folder path, so adopting its name keeps the package addressable.
    name: options.allowDirectoryNameMismatch ? directoryName : frontmatter.name,
    description: frontmatter.description.trim(),
    instructions: match[2].replace(/\r\n/g, '\n').trim(),
    frontmatter,
  };
  try {
    validateAgentSkillInput(parsed, options);
  } catch (error) {
    if (error instanceof AgentSkillValidationError) {
      throw new AgentSkillCodecError(error.message, { cause: error });
    }
    throw error;
  }
  return parsed;
}

function serializeYamlFallback(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    if (typeof value === 'string' && value.includes('\n')) {
      lines.push(`${key}: |-`);
      lines.push(...value.split('\n').map(line => `  ${line}`));
      continue;
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return lines.join('\n');
}

function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  if (typeof stringifyYaml === 'function') {
    return stringifyYaml(frontmatter).trimEnd();
  }
  return serializeYamlFallback(frontmatter);
}

export function serializeAgentSkillMarkdown(
  currentFrontmatter: Record<string, unknown>,
  input: AgentSkillInput,
): string {
  validateAgentSkillInput(input);
  const normalized: AgentSkillInput = {
    name: input.name,
    description: input.description.trim(),
    instructions: input.instructions.trim(),
  };
  const frontmatter: Record<string, unknown> = {
    ...currentFrontmatter,
    name: normalized.name,
    description: normalized.description,
  };
  return `---\n${serializeFrontmatter(frontmatter)}\n---\n${normalized.instructions}\n`;
}
