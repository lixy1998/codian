import {
  CODEBUDDY_VAULT_SKILLS_PATH,
  CodebuddyVaultSkillRepository,
  SHARED_VAULT_SKILLS_PATH,
} from '@/providers/codebuddy/commands/CodebuddyVaultSkillRepository';

const SKILL = (name: string, description = 'does things') => [
  '---',
  `name: ${name}`,
  `description: ${description}`,
  '---',
  '',
  `# ${name}`,
  '',
  'Instructions body.',
].join('\n');

function createFiles(files: Record<string, string>, folders: string[] = []) {
  return {
    listFolders: jest.fn(async (folder: string) => folders.filter(path => (
      path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/')
    ))),
    read: jest.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`missing: ${path}`);
      return content;
    }),
    write: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteFolder: jest.fn(async () => undefined),
    ensureFolder: jest.fn(async () => undefined),
  };
}

describe('CodebuddyVaultSkillRepository', () => {
  it('lists skills from the folder CodeBuddy reads', async () => {
    const files = createFiles({
      [`${CODEBUDDY_VAULT_SKILLS_PATH}/史料研读助手/SKILL.md`]: SKILL('史料研读助手', '史料研读'),
      [`${CODEBUDDY_VAULT_SKILLS_PATH}/assets/notes.txt`]: 'not a skill',
    }, [`${CODEBUDDY_VAULT_SKILLS_PATH}/史料研读助手`, `${CODEBUDDY_VAULT_SKILLS_PATH}/assets`]);
    const repository = new CodebuddyVaultSkillRepository(files);

    const entries = await repository.listVaultEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      providerId: 'codebuddy',
      kind: 'skill',
      name: '史料研读助手',
      description: '史料研读',
      scope: 'vault',
      sourcePath: `${CODEBUDDY_VAULT_SKILLS_PATH}/史料研读助手/SKILL.md`,
    });
  });

  it('points the source at the shared package while both copies match', async () => {
    const raw = SKILL('json-canvas');
    const files = createFiles({
      [`${CODEBUDDY_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`]: raw,
      [`${SHARED_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`]: raw,
    }, [`${CODEBUDDY_VAULT_SKILLS_PATH}/json-canvas`]);
    const repository = new CodebuddyVaultSkillRepository(files);

    const [entry] = await repository.listVaultEntries();

    expect(entry.sourcePath).toBe(`${SHARED_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`);
  });

  it('keeps its own path when the copies diverged', async () => {
    const files = createFiles({
      [`${CODEBUDDY_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`]: SKILL('json-canvas', 'local edit'),
      [`${SHARED_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`]: SKILL('json-canvas', 'shared'),
    }, [`${CODEBUDDY_VAULT_SKILLS_PATH}/json-canvas`]);
    const repository = new CodebuddyVaultSkillRepository(files);

    const [entry] = await repository.listVaultEntries();

    expect(entry.sourcePath).toBe(`${CODEBUDDY_VAULT_SKILLS_PATH}/json-canvas/SKILL.md`);
  });
});
