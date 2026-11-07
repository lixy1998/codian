import * as path from 'node:path';

import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderVaultEntryRepository } from '../../../core/providers/commands/ProviderVaultEntryRepository';
import { parseAgentSkillMarkdown, serializeAgentSkillMarkdown } from '../../../core/skills/AgentSkillCodec';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';

/** Where CodeBuddy Code loads project-level skills from. */
export const CODEBUDDY_VAULT_SKILLS_PATH = '.codebuddy/skills';
/** The vault-wide skill root every other Codian provider shares. */
export const SHARED_VAULT_SKILLS_PATH = '.agents/skills';
const SKILL_FILENAME = 'SKILL.md';
const PERSISTENCE_PREFIX = 'codebuddy-skill';

export type CodebuddySkillStorageAdapter = Pick<
  VaultFileAdapter,
  'read' | 'write' | 'delete' | 'deleteFolder' | 'listFolders' | 'ensureFolder'
>;

function persistenceKey(name: string): string {
  return `${PERSISTENCE_PREFIX}:${encodeURIComponent(name)}`;
}

function directoryNameFromKey(key: string | undefined): string | null {
  if (!key?.startsWith(`${PERSISTENCE_PREFIX}:`)) return null;
  const encoded = key.slice(PERSISTENCE_PREFIX.length + 1);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Lists the skills CodeBuddy itself reads (`.codebuddy/skills`). Codian only shows them; the
 * package stays owned by the vault.
 *
 * CodeBuddy does not scan `.agents/skills`, so a skill mirrored into both folders would otherwise
 * appear twice in the workspace list. When the copies are byte-identical the entry points its
 * source at the shared package, which lets the settings list merge the two into one row with
 * CodeBuddy added to its provider column. Copies that drifted keep their own path, so the
 * duplicate stays visible instead of hiding the divergence.
 */
export class CodebuddyVaultSkillRepository implements ProviderVaultEntryRepository {
  constructor(private readonly files: CodebuddySkillStorageAdapter) {}

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    let folders: string[];
    try {
      folders = await this.files.listFolders(CODEBUDDY_VAULT_SKILLS_PATH);
    } catch {
      return [];
    }

    const entries: ProviderCommandEntry[] = [];
    for (const folder of folders) {
      const name = path.posix.basename(folder);
      if (!name) continue;
      const filePath = `${CODEBUDDY_VAULT_SKILLS_PATH}/${name}/${SKILL_FILENAME}`;

      let raw: string;
      try {
        raw = await this.files.read(filePath);
      } catch {
        // Folders without a SKILL.md (scripts, assets) are not skills.
        continue;
      }

      try {
        const parsed = parseAgentSkillMarkdown(raw, name, {
          allowDirectoryNameMismatch: true,
          requirePortableName: false,
        });
        entries.push({
          id: `${PERSISTENCE_PREFIX}:${name}`,
          providerId: 'codebuddy',
          kind: 'skill',
          name: parsed.name,
          description: parsed.description,
          content: parsed.instructions,
          scope: 'vault',
          source: 'user',
          isEditable: true,
          isDeletable: true,
          displayPrefix: '',
          insertPrefix: '',
          sourcePath: await this.sharedSourcePath(name, raw) ?? filePath,
          persistenceKey: persistenceKey(name),
        });
      } catch {
        // Same per-skill tolerance as the shared discovery: one broken package must not hide the rest.
      }
    }

    return entries;
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    const previousName = directoryNameFromKey(entry.persistenceKey);
    const directory = `${CODEBUDDY_VAULT_SKILLS_PATH}/${entry.name}`;
    await this.files.ensureFolder(directory);
    await this.files.write(
      `${directory}/${SKILL_FILENAME}`,
      serializeAgentSkillMarkdown({}, {
        name: entry.name,
        description: entry.description ?? '',
        instructions: entry.content,
      }),
    );

    if (previousName && previousName !== entry.name) {
      await this.deleteVaultEntry({ ...entry, persistenceKey: persistenceKey(previousName) });
    }
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    const name = directoryNameFromKey(entry.persistenceKey) ?? entry.name;
    const directory = `${CODEBUDDY_VAULT_SKILLS_PATH}/${name}`;
    await this.files.delete(`${directory}/${SKILL_FILENAME}`);
    await this.files.deleteFolder(directory);
  }

  /** The shared package path, but only while both copies still hold the same bytes. */
  private async sharedSourcePath(name: string, raw: string): Promise<string | null> {
    const sharedPath = `${SHARED_VAULT_SKILLS_PATH}/${name}/${SKILL_FILENAME}`;
    try {
      return (await this.files.read(sharedPath)) === raw ? sharedPath : null;
    } catch {
      return null;
    }
  }
}
