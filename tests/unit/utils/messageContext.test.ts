import { buildMessageContextRefs } from '@/utils/messageContext';

describe('buildMessageContextRefs', () => {
  it('returns undefined when nothing is quoted', () => {
    expect(buildMessageContextRefs({})).toBeUndefined();
  });

  it('describes a selection with its line range', () => {
    const refs = buildMessageContextRefs({
      currentNotePath: '0-Inbox/原创命题.md',
      editorSelection: {
        notePath: '0-Inbox/原创命题.md',
        mode: 'selection',
        selectedText: '将这份参赛要求作为规范存一下。',
        startLine: 120,
        lineCount: 2,
      },
    });

    expect(refs).toEqual([{
      kind: 'selection',
      label: '原创命题.md',
      path: '0-Inbox/原创命题.md',
      lines: { start: 120, end: 121 },
      excerpt: '将这份参赛要求作为规范存一下。',
    }]);
  });

  it('falls back to the current note without a selection', () => {
    const refs = buildMessageContextRefs({ currentNotePath: 'notes/a.md' });

    expect(refs).toEqual([{ kind: 'note', label: 'a.md', path: 'notes/a.md' }]);
  });

  it('lists dropped documents with their size', () => {
    const refs = buildMessageContextRefs({
      documents: [{
        id: 'doc-1',
        name: '规范.docx',
        path: 'C:/docs/规范.docx',
        mediaType: 'application/octet-stream',
        size: 2048,
        text: null,
        source: 'drop',
      }],
    });

    expect(refs).toEqual([{
      kind: 'document',
      label: '规范.docx',
      path: 'C:/docs/规范.docx',
      size: 2048,
      excerpt: undefined,
    }]);
  });

  it('clips long excerpts for display', () => {
    const refs = buildMessageContextRefs({
      documents: [{
        id: 'doc-2',
        name: 'long.txt',
        mediaType: 'text/plain',
        size: 10,
        text: 'x'.repeat(5000),
        source: 'drop',
      }],
    });

    expect(refs?.[0].excerpt?.length).toBe(1201);
    expect(refs?.[0].excerpt?.endsWith('…')).toBe(true);
  });
});
