import { DiscoveredAgentSkillRepository } from '@/core/skills/DiscoveredAgentSkillRepository';

function markdown(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Shared skill',
    '---',
    'Instructions.',
  ].join('\n');
}

describe('DiscoveredAgentSkillRepository', () => {
  it('lists externally managed vault skill directories without changing them', async () => {
    const repository = new DiscoveredAgentSkillRepository({
      listFolders: jest.fn().mockResolvedValue([
        '.agents/skills/shared-skill',
        '.agents/skills/broken',
      ]),
      read: jest.fn().mockImplementation(async (path: string) => (
        path.includes('shared-skill') ? markdown('shared-skill') : 'not a skill'
      )),
    });

    await expect(repository.list()).resolves.toEqual({
      skills: [expect.objectContaining({
          name: 'shared-skill',
          directoryPath: '.agents/skills/shared-skill',
          filePath: '.agents/skills/shared-skill/SKILL.md',
        })],
      diagnostics: [expect.objectContaining({
        directoryPath: '.agents/skills/broken',
      })],
    });
  });

  it('lists a skill whose folder name is not ASCII-portable', async () => {
    const repository = new DiscoveredAgentSkillRepository({
      listFolders: jest.fn().mockResolvedValue(['.agents/skills/技能去痕']),
      read: jest.fn().mockResolvedValue(markdown('技能去痕')),
    });

    const result = await repository.list();

    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toEqual([
      expect.objectContaining({
        name: '技能去痕',
        directoryPath: '.agents/skills/技能去痕',
        filePath: '.agents/skills/技能去痕/SKILL.md',
      }),
    ]);
  });

  it('adopts the folder name when the frontmatter name is stale', async () => {
    const repository = new DiscoveredAgentSkillRepository({
      listFolders: jest.fn().mockResolvedValue(['.agents/skills/技能去痕']),
      read: jest.fn().mockResolvedValue(markdown('另一个名字')),
    });

    const result = await repository.list();

    // The folder is the package identity; a mismatch left behind by an installer must not
    // hide an otherwise usable skill.
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toEqual([
      expect.objectContaining({
        name: '技能去痕',
        directoryPath: '.agents/skills/技能去痕',
      }),
    ]);
  });
});
