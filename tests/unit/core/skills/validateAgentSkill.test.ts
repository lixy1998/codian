import {
  AgentSkillValidationError,
  validateAgentSkillInput,
  validateAgentSkillName,
} from '@/core/skills/validateAgentSkill';

describe('validateAgentSkill', () => {
  it.each(['skill', 'skill-2', 'a', 'a'.repeat(64)])('accepts portable name %s', name => {
    expect(validateAgentSkillName(name)).toBeNull();
  });

  it.each([
    '', '-skill', 'skill-', 'skill--name', 'Skill', 'skill_name', 'skill/name',
    'a'.repeat(65), 'true', 'false', 'null', 'yes', 'no', 'on', 'off',
  ])('rejects non-portable name %s', name => {
    expect(validateAgentSkillName(name)).not.toBeNull();
  });

  it('accepts non-ASCII names when portable naming is not required', () => {
    for (const name of ['技能去痕', 'Obsidian历史题库搭建与组卷', '史料研读助手']) {
      expect(validateAgentSkillName(name)).not.toBeNull();
      expect(validateAgentSkillName(name, { requirePortableName: false })).toBeNull();
    }
  });

  it('still rejects names that cannot be a folder name in permissive mode', () => {
    for (const name of ['', ' padded ', 'a/b', 'a\\b', 'a'.repeat(65)]) {
      expect(validateAgentSkillName(name, { requirePortableName: false })).not.toBeNull();
    }
  });

  it('requires a non-empty description no longer than 1024 characters', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: '   ',
      instructions: 'Do the work.',
    })).toThrow(AgentSkillValidationError);

    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: 'a'.repeat(1025),
      instructions: 'Do the work.',
    })).toThrow('1024');
  });

  it('requires non-empty instructions', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: 'Portable skill',
      instructions: '\n\t ',
    })).toThrow('instructions');
  });

  it('accepts trimmed boundary values', () => {
    expect(() => validateAgentSkillInput({
      name: 'portable-skill',
      description: ` ${'a'.repeat(1024)} `,
      instructions: ' Do the work. ',
    })).not.toThrow();
  });
});
