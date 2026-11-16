/**
 * Codian - Message Context Refs
 *
 * Summarizes what a user turn quoted (current note, editor selection, dropped
 * documents) so the sent bubble can show its sources.
 */

import type { DocumentAttachment, MessageContextRef } from '../core/types';
import type { EditorSelectionContext } from './editor';

/** Excerpt length kept for display and storage; the prompt always carries the full text. */
const MAX_EXCERPT_CHARS = 1200;

export interface BuildMessageContextRefsInput {
  currentNotePath?: string;
  editorSelection?: EditorSelectionContext | null;
  documents?: readonly DocumentAttachment[];
}

function baseName(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
}

function clipExcerpt(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_EXCERPT_CHARS
    ? `${trimmed.slice(0, MAX_EXCERPT_CHARS)}…`
    : trimmed;
}

export function buildMessageContextRefs(
  input: BuildMessageContextRefsInput,
): MessageContextRef[] | undefined {
  const refs: MessageContextRef[] = [];
  const selection = input.editorSelection;

  if (selection && selection.mode === 'selection' && selection.selectedText) {
    refs.push({
      kind: 'selection',
      label: baseName(selection.notePath),
      path: selection.notePath,
      ...(selection.startLine && {
        lines: {
          start: selection.startLine,
          end: selection.startLine + Math.max(1, selection.lineCount ?? 1) - 1,
        },
      }),
      excerpt: clipExcerpt(selection.selectedText),
    });
  } else if (input.currentNotePath) {
    refs.push({
      kind: 'note',
      label: baseName(input.currentNotePath),
      path: input.currentNotePath,
    });
  }

  for (const document of input.documents ?? []) {
    refs.push({
      kind: 'document',
      label: document.name,
      ...(document.path && { path: document.path }),
      size: document.size,
      excerpt: clipExcerpt(document.text ?? undefined),
    });
  }

  return refs.length > 0 ? refs : undefined;
}
