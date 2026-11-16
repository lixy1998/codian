import {
  appendEditorContext,
  buildCursorContext,
  buildNoteExcerpt,
  type EditorSelectionContext,
  findNearestNonEmptyLine,
  formatEditorContext,
} from '@/utils/editor';

function makeGetLine(lines: string[]): (line: number) => string {
  return (line: number) => lines[line] ?? '';
}

describe('findNearestNonEmptyLine', () => {
  const lines = ['first', '', 'third', '', 'fifth'];
  const getLine = makeGetLine(lines);

  it('finds nearest non-empty line before', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 1, 'before')).toBe('first');
  });

  it('finds nearest non-empty line after', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 1, 'after')).toBe('third');
  });

  it('skips multiple empty lines before', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 3, 'before')).toBe('third');
  });

  it('skips multiple empty lines after', () => {
    expect(findNearestNonEmptyLine(getLine, lines.length, 3, 'after')).toBe('fifth');
  });

  it('returns empty string when no non-empty line exists before', () => {
    const emptyLines = ['', '', 'content'];
    expect(findNearestNonEmptyLine(makeGetLine(emptyLines), emptyLines.length, 0, 'before')).toBe('');
  });

  it('returns empty string when no non-empty line exists after', () => {
    const emptyLines = ['content', '', ''];
    expect(findNearestNonEmptyLine(makeGetLine(emptyLines), emptyLines.length, 2, 'after')).toBe('');
  });

  it('skips whitespace-only lines', () => {
    const lines = ['content', '   ', '  \t  ', 'found'];
    expect(findNearestNonEmptyLine(makeGetLine(lines), lines.length, 0, 'after')).toBe('found');
  });
});

describe('buildCursorContext', () => {
  it('splits line at cursor position', () => {
    const lines = ['hello world'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 5);
    expect(result.beforeCursor).toBe('hello');
    expect(result.afterCursor).toBe(' world');
    expect(result.isInbetween).toBe(false);
    expect(result.line).toBe(0);
    expect(result.column).toBe(5);
  });

  it('cursor at start of line', () => {
    const lines = ['', 'next line'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 0);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('');
    expect(result.afterCursor).toBe('next line');
  });

  it('cursor on empty line between content', () => {
    const lines = ['above', '', 'below'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 1, 0);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('above');
    expect(result.afterCursor).toBe('below');
  });

  it('cursor on whitespace-only line', () => {
    const lines = ['above', '   ', 'below'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 1, 1);
    expect(result.isInbetween).toBe(true);
    expect(result.beforeCursor).toBe('above');
    expect(result.afterCursor).toBe('below');
  });

  it('cursor at end of non-empty line is not inbetween', () => {
    const lines = ['hello'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 5);
    expect(result.isInbetween).toBe(false);
    expect(result.beforeCursor).toBe('hello');
    expect(result.afterCursor).toBe('');
  });

  it('cursor in middle of word', () => {
    const lines = ['function test() {}'];
    const result = buildCursorContext(makeGetLine(lines), lines.length, 0, 8);
    expect(result.beforeCursor).toBe('function');
    expect(result.afterCursor).toBe(' test() {}');
    expect(result.isInbetween).toBe(false);
  });
});

describe('formatEditorContext', () => {
  it('formats selection context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'selected content',
      startLine: 5,
      lineCount: 3,
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_selection path="test.md" lines="5-7">\n<![CDATA[selected content]]>\n</editor_selection>');
  });

  it('formats selection without line info', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'selected',
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_selection path="test.md">\n<![CDATA[selected]]>\n</editor_selection>');
  });

  it('formats inline cursor context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'hello',
        afterCursor: ' world',
        isInbetween: false,
        line: 0,
        column: 5,
      },
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_cursor path="test.md">\n<![CDATA[hello| world #inline]]>\n</editor_cursor>');
  });

  it('formats inbetween cursor context', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'above',
        afterCursor: 'below',
        isInbetween: true,
        line: 1,
        column: 0,
      },
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_cursor path="test.md">\n<![CDATA[above\n| #inbetween\nbelow]]>\n</editor_cursor>');
  });

  it('formats inbetween cursor with no before content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: 'below',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_cursor path="test.md">\n<![CDATA[| #inbetween\nbelow]]>\n</editor_cursor>');
  });

  it('formats inbetween cursor with no after content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: 'above',
        afterCursor: '',
        isInbetween: true,
        line: 5,
        column: 0,
      },
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_cursor path="test.md">\n<![CDATA[above\n| #inbetween]]>\n</editor_cursor>');
  });

  it('formats inbetween cursor with no before and no after content', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
      cursorContext: {
        beforeCursor: '',
        afterCursor: '',
        isInbetween: true,
        line: 0,
        column: 0,
      },
    };
    const result = formatEditorContext(context);
    expect(result).toBe('<editor_cursor path="test.md">\n<![CDATA[| #inbetween]]>\n</editor_cursor>');
  });

  it('returns empty string for none mode', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'none',
    };
    expect(formatEditorContext(context)).toBe('');
  });

  it('returns empty string for selection mode without selectedText', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
    };
    expect(formatEditorContext(context)).toBe('');
  });

  it('escapes paths and literal XML in editor content', () => {
    const result = formatEditorContext({
      notePath: 'notes/a&b"<c>.md',
      mode: 'selection',
      selectedText: 'literal </editor_selection> and ]]> text',
    });
    expect(result).toBe(
      '<editor_selection path="notes/a&amp;b&quot;&lt;c&gt;.md">\n'
      + '<![CDATA[literal </editor_selection> and ]]]]><![CDATA[> text]]>\n'
      + '</editor_selection>',
    );
  });

  it('returns empty string for cursor mode without cursorContext', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'cursor',
    };
    expect(formatEditorContext(context)).toBe('');
  });
});

describe('appendEditorContext', () => {
  it('appends formatted context to prompt', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'selection',
      selectedText: 'text',
      startLine: 1,
      lineCount: 1,
    };
    const result = appendEditorContext('Fix this', context);
    expect(result).toBe('Fix this\n\n<editor_selection path="test.md" lines="1-1">\n<![CDATA[text]]>\n</editor_selection>');
  });

  it('returns prompt unchanged when context is none', () => {
    const context: EditorSelectionContext = {
      notePath: 'test.md',
      mode: 'none',
    };
    expect(appendEditorContext('Fix this', context)).toBe('Fix this');
  });
});

describe('buildNoteExcerpt', () => {
  it('returns the whole note when it fits the budget', () => {
    const excerpt = buildNoteExcerpt('line1\nline2\nline3', 2, 1);
    expect(excerpt).toEqual({
      content: 'line1\nline2\nline3',
      startLine: 1,
      endLine: 3,
      truncated: false,
      totalLines: 3,
    });
  });

  it('windows a large note around the selection', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index + 1} ${'x'.repeat(100)}`);
    const excerpt = buildNoteExcerpt(lines.join('\n'), 200, 2);

    expect(excerpt?.truncated).toBe(true);
    expect(excerpt?.totalLines).toBe(400);
    expect(excerpt?.startLine).toBe(120);
    expect(excerpt?.endLine).toBe(281);
    expect(excerpt?.content.split('\n')[0]).toContain('line 120');
  });

  it('returns undefined for empty content', () => {
    expect(buildNoteExcerpt('', 1, 1)).toBeUndefined();
  });
});

describe('formatEditorContext note context', () => {
  it('carries the absolute path and the host note excerpt', () => {
    const context: EditorSelectionContext = {
      notePath: 'notes/a.md',
      noteAbsolutePath: 'D:/vault/notes/a.md',
      mode: 'selection',
      selectedText: 'picked',
      startLine: 2,
      lineCount: 1,
      noteExcerpt: { content: 'a\nb\nc', startLine: 1, endLine: 3, truncated: false, totalLines: 3 },
    };
    const result = formatEditorContext(context);

    expect(result).toContain('<editor_selection path="notes/a.md" full_path="D:/vault/notes/a.md" lines="2-2">');
    expect(result).toContain('<editor_note path="notes/a.md" full_path="D:/vault/notes/a.md" lines="1-3" total_lines="3">');
    expect(result).toContain('<![CDATA[a\nb\nc]]>');
  });

  it('stays selection-only without an excerpt', () => {
    const context: EditorSelectionContext = {
      notePath: 'notes/a.md',
      mode: 'selection',
      selectedText: 'picked',
    };

    expect(formatEditorContext(context)).toBe(
      '<editor_selection path="notes/a.md">\n<![CDATA[picked]]>\n</editor_selection>',
    );
  });

  it('marks a truncated excerpt', () => {
    const context: EditorSelectionContext = {
      notePath: 'notes/a.md',
      mode: 'selection',
      selectedText: 'picked',
      noteExcerpt: { content: 'body', startLine: 120, endLine: 281, truncated: true, totalLines: 400 },
    };

    expect(formatEditorContext(context)).toContain('truncated="true"');
  });
});
