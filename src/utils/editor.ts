/**
 * Codian - Editor Context Utilities
 *
 * Editor cursor and selection context for inline editing.
 */

import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

import { escapePromptXmlAttribute, formatPromptXmlCdata } from './promptXml';

/**
 * Gets the CodeMirror EditorView from an Obsidian Editor.
 * Obsidian's Editor type doesn't expose the internal `.cm` property.
 */
export function getEditorView(editor: Editor): EditorView | undefined {
  return (editor as unknown as { cm?: EditorView }).cm;
}

export interface CursorContext {
  beforeCursor: string;
  afterCursor: string;
  isInbetween: boolean;
  line: number;
  column: number;
}

export interface EditorSelectionContext {
  notePath: string;
  /** Absolute path of the host note, so providers can open it without a search step. */
  noteAbsolutePath?: string;
  mode: 'selection' | 'cursor' | 'none';
  selectedText?: string;
  cursorContext?: CursorContext;
  lineCount?: number; // Number of lines in selection (for UI indicator)
  startLine?: number; // 1-indexed starting line number
  /** Host note text around the selection, so the model needs no extra read. */
  noteExcerpt?: NoteExcerpt;
}

/**
 * Note text shipped alongside a selection.
 *
 * Small notes travel whole; large ones are windowed around the selection so the
 * prompt stays bounded.
 */
export interface NoteExcerpt {
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  totalLines: number;
}

/** Character budget for the excerpt; a longer note is windowed instead. */
export const NOTE_EXCERPT_MAX_CHARS = 30_000;

/** Lines of surrounding context kept on each side of the selection. */
const NOTE_EXCERPT_CONTEXT_LINES = 80;

export function buildNoteExcerpt(
  content: string,
  startLine: number | undefined,
  lineCount: number | undefined,
): NoteExcerpt | undefined {
  if (!content) return undefined;

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  if (content.length <= NOTE_EXCERPT_MAX_CHARS) {
    return { content, startLine: 1, endLine: totalLines, truncated: false, totalLines };
  }

  const anchor = startLine && startLine > 0 ? startLine : 1;
  const span = Math.max(1, lineCount ?? 1);
  const from = Math.max(1, anchor - NOTE_EXCERPT_CONTEXT_LINES);
  const to = Math.min(totalLines, anchor + span - 1 + NOTE_EXCERPT_CONTEXT_LINES);
  const windowed = lines.slice(from - 1, to).join('\n');

  return {
    content: windowed.length > NOTE_EXCERPT_MAX_CHARS
      ? windowed.slice(0, NOTE_EXCERPT_MAX_CHARS)
      : windowed,
    startLine: from,
    endLine: to,
    truncated: true,
    totalLines,
  };
}

export interface EditorContextFormatOptions {
  includeCursorLine?: boolean;
}

export function findNearestNonEmptyLine(
  getLine: (line: number) => string,
  lineCount: number,
  startLine: number,
  direction: 'before' | 'after'
): string {
  const step = direction === 'before' ? -1 : 1;
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i);
    if (content.trim().length > 0) {
      return content;
    }
  }
  return '';
}

/** All line/column params are 0-indexed. */
export function buildCursorContext(
  getLine: (line: number) => string,
  lineCount: number,
  line: number,
  column: number
): CursorContext {
  const lineContent = getLine(line);
  const beforeCursor = lineContent.substring(0, column);
  const afterCursor = lineContent.substring(column);

  const lineIsEmpty = lineContent.trim().length === 0;
  const nothingBefore = beforeCursor.trim().length === 0;
  const nothingAfter = afterCursor.trim().length === 0;
  const isInbetween = lineIsEmpty || (nothingBefore && nothingAfter);

  let contextBefore = beforeCursor;
  let contextAfter = afterCursor;

  if (isInbetween) {
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, 'before');
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, 'after');
  }

  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column };
}

function formatNotePathAttributes(context: EditorSelectionContext): string {
  const attrs = [`path="${escapePromptXmlAttribute(context.notePath)}"`];
  if (context.noteAbsolutePath) {
    attrs.push(`full_path="${escapePromptXmlAttribute(context.noteAbsolutePath)}"`);
  }
  return attrs.join(' ');
}

function formatNoteExcerpt(context: EditorSelectionContext): string {
  const excerpt = context.noteExcerpt;
  if (!excerpt || !excerpt.content) return '';

  const attrs = [
    formatNotePathAttributes(context),
    `lines="${excerpt.startLine}-${excerpt.endLine}"`,
    `total_lines="${excerpt.totalLines}"`,
  ];
  if (excerpt.truncated) attrs.push('truncated="true"');

  return `<editor_note ${attrs.join(' ')}>\n${formatPromptXmlCdata(excerpt.content)}\n</editor_note>`;
}

export function formatEditorContext(
  context: EditorSelectionContext,
  options: EditorContextFormatOptions = {},
): string {
  if (context.mode === 'selection' && context.selectedText !== undefined) {
    const lineAttr = context.startLine && context.lineCount
      ? ` lines="${context.startLine}-${context.startLine + context.lineCount - 1}"`
      : '';
    const pathAttrs = formatNotePathAttributes(context);
    const selectionBlock = `<editor_selection ${pathAttrs}${lineAttr}>\n${formatPromptXmlCdata(
      context.selectedText,
    )}\n</editor_selection>`;

    const noteBlock = formatNoteExcerpt(context);
    return noteBlock ? `${selectionBlock}\n\n${noteBlock}` : selectionBlock;
  } else if (context.mode === 'cursor' && context.cursorContext) {
    const ctx = context.cursorContext;
    let content: string;
    if (ctx.isInbetween) {
      const parts = [];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push('| #inbetween');
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      content = parts.join('\n');
    } else {
      content = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
    }
    const lineAttr = options.includeCursorLine ? ` line="${ctx.line + 1}"` : '';
    return `<editor_cursor ${formatNotePathAttributes(context)}${lineAttr}>\n${formatPromptXmlCdata(
      content,
    )}\n</editor_cursor>`;
  }
  return '';
}

export function appendEditorContext(prompt: string, context: EditorSelectionContext): string {
  const formatted = formatEditorContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
