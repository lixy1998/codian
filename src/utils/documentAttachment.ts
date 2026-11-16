/**
 * Codian - Document Attachment Utilities
 *
 * Composer attachments that are not images. Text-like files are decoded inline so
 * every provider receives the same prompt payload; binary formats keep a path for
 * the agent's own file tools.
 */

import * as path from 'path';

import type { DocumentAttachment } from '../core/types';

/** Per-document character budget; a larger file is clipped and flagged. */
export const MAX_DOCUMENT_TEXT_CHARS = 120_000;

/** Combined character budget across all attachments in one turn. */
export const MAX_TOTAL_DOCUMENT_TEXT_CHARS = 200_000;

/** Bytes read for either the text probe or the decoded text itself. */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Bytes inspected when deciding whether an unknown format is text. */
const TEXT_PROBE_BYTES = 8192;

const TEXT_EXTENSIONS = new Set([
  'adoc',
  'bash',
  'bat',
  'bib',
  'c',
  'canvas',
  'cc',
  'cfg',
  'cmd',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'diff',
  'env',
  'go',
  'gradle',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'json5',
  'jsonl',
  'jsx',
  'kt',
  'kts',
  'less',
  'log',
  'lua',
  'markdown',
  'md',
  'mjs',
  'mts',
  'org',
  'patch',
  'php',
  'pl',
  'properties',
  'ps1',
  'py',
  'pyw',
  'r',
  'rb',
  'rs',
  'rst',
  'scss',
  'sh',
  'sql',
  'srt',
  'svelte',
  'swift',
  'tex',
  'text',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vbs',
  'vue',
  'vtt',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  htm: 'text/html',
  html: 'text/html',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'text/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
};

export function getDocumentExtension(filename: string | null | undefined): string {
  if (!filename) return '';
  return path.extname(filename).toLowerCase().replace(/^\./, '');
}

export function getDocumentMediaType(filename: string): string {
  return MIME_BY_EXTENSION[getDocumentExtension(filename)] ?? 'application/octet-stream';
}

/** True when the extension is a format we can decode as plain text. */
export function isTextDocumentName(filename: string): boolean {
  return TEXT_EXTENSIONS.has(getDocumentExtension(filename));
}

/**
 * Resolves the absolute path of a dropped `File`.
 *
 * Renderers stopped exposing `File.path` in newer Electron versions, so the
 * `webUtils` bridge is tried afterwards.
 */
export function getDroppedFilePath(file: File): string | undefined {
  const legacyPath = (file as File & { path?: string }).path;
  if (typeof legacyPath === 'string' && legacyPath.length > 0) {
    return legacyPath;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron is exposed only at runtime in Obsidian's renderer.
    const { webUtils } = require('electron') as {
      webUtils?: { getPathForFile?: (target: File) => string };
    };
    const resolved = webUtils?.getPathForFile?.(file);
    if (typeof resolved === 'string' && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // Older Electron builds have no webUtils; the path simply stays unknown.
  }
  return undefined;
}

function stripByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const utf8ReplacementCount = countReplacementCharacters(utf8);
  if (utf8ReplacementCount === 0) {
    return stripByteOrderMark(utf8);
  }

  // Chinese Windows still produces GBK notes; prefer it when it decodes cleaner.
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    if (countReplacementCharacters(gbk) < utf8ReplacementCount) {
      return stripByteOrderMark(gbk);
    }
  } catch {
    // Unsupported decoder; keep the UTF-8 result.
  }
  return stripByteOrderMark(utf8);
}

function countReplacementCharacters(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === '\uFFFD') count += 1;
  }
  return count;
}

function looksLikeText(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, TEXT_PROBE_BYTES);
  if (limit === 0) return true;
  let suspicious = 0;
  for (let index = 0; index < limit; index++) {
    const byte = buffer[index];
    if (byte === 0) return false;
    // Allow tab, LF, FF, CR, and everything printable.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      suspicious += 1;
    }
  }
  return suspicious / limit < 0.02;
}

export interface DocumentAttachmentLimits {
  /** Remaining character budget shared by the whole turn. */
  remainingChars: number;
}

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDocumentError';
  }
}

/**
 * Builds an attachment from a dropped or picked file.
 *
 * Text-like formats are decoded (clipped to the remaining budget); binary
 * formats keep only metadata plus an absolute path for the agent to open.
 */
export async function createDocumentAttachment(
  file: File,
  source: DocumentAttachment['source'],
  limits: DocumentAttachmentLimits,
): Promise<DocumentAttachment> {
  const name = file.name || 'attachment';
  const size = file.size;
  const documentPath = getDroppedFilePath(file);
  const declaredText = isTextDocumentName(name);

  const head = await readHead(file, TEXT_PROBE_BYTES);
  const treatAsText = declaredText || (head.length > 0 && looksLikeText(head));

  if (treatAsText) {
    const raw = await readHead(file, MAX_DOCUMENT_BYTES);
    const decoded = decodeTextBuffer(raw);
    const clippedToBytes = size > MAX_DOCUMENT_BYTES;
    const budget = Math.max(0, Math.min(MAX_DOCUMENT_TEXT_CHARS, limits.remainingChars));
    const clippedToBudget = decoded.length > budget;
    const text = clippedToBudget ? decoded.slice(0, budget) : decoded;
    return {
      id: createAttachmentId(),
      name,
      path: documentPath,
      mediaType: getDocumentMediaType(name),
      size,
      text,
      truncated: clippedToBytes || clippedToBudget ? true : undefined,
      source,
    };
  }

  if (!documentPath) {
    throw new UnsupportedDocumentError('unresolved-path');
  }

  return {
    id: createAttachmentId(),
    name,
    path: documentPath,
    mediaType: getDocumentMediaType(name),
    size,
    text: null,
    source,
  };
}

async function readHead(file: File, limit: number): Promise<Buffer> {
  const slice = file.size > limit ? file.slice(0, limit) : file;
  const arrayBuffer = await slice.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function createAttachmentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
