import { appendAttachedDocuments, XML_CONTEXT_PATTERN } from '../../../src/utils/context';
import {
  createDocumentAttachment,
  MAX_DOCUMENT_TEXT_CHARS,
  UnsupportedDocumentError,
} from '../../../src/utils/documentAttachment';

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Builds a File-like object without relying on jsdom's Blob implementation. */
function makeFile(name: string, bytes: Buffer): File {
  const file = new File([new Uint8Array()], name);
  Object.defineProperty(file, 'name', { value: name });
  Object.defineProperty(file, 'size', { value: bytes.length });
  const slice = (start?: number, end?: number): File =>
    makeFile(name, bytes.subarray(start ?? 0, end ?? bytes.length));
  Object.defineProperty(file, 'slice', { value: slice });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => toArrayBuffer(bytes) });
  return file;
}

const FULL_BUDGET = { remainingChars: MAX_DOCUMENT_TEXT_CHARS };

describe('createDocumentAttachment', () => {
  it('inlines text-like files', async () => {
    const file = makeFile('notes.md', Buffer.from('# 标题\n正文', 'utf-8'));
    const attachment = await createDocumentAttachment(file, 'drop', FULL_BUDGET);

    expect(attachment.text).toBe('# 标题\n正文');
    expect(attachment.truncated).toBeUndefined();
    expect(attachment.mediaType).toBe('text/markdown');
  });

  it('decodes GBK text when UTF-8 yields replacement characters', async () => {
    // "中文" encoded as GBK: D6 D0 CE C4
    const file = makeFile('gbk.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    const attachment = await createDocumentAttachment(file, 'drop', FULL_BUDGET);

    expect(attachment.text).toBe('中文');
  });

  it('clips text to the remaining budget and flags it', async () => {
    const file = makeFile('big.txt', Buffer.from('abcdefghij', 'utf-8'));
    const attachment = await createDocumentAttachment(file, 'drop', { remainingChars: 4 });

    expect(attachment.text).toBe('abcd');
    expect(attachment.truncated).toBe(true);
  });

  it('keeps binary files as path references', async () => {
    const file = makeFile('report.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x41]));
    Object.defineProperty(file, 'path', { value: 'C:\\docs\\report.docx' });

    const attachment = await createDocumentAttachment(file, 'drop', FULL_BUDGET);

    expect(attachment.text).toBeNull();
    expect(attachment.path).toBe('C:\\docs\\report.docx');
    expect(attachment.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('rejects binary files whose path cannot be resolved', async () => {
    const file = makeFile('report.docx', Buffer.from([0x00, 0x01, 0x02]));

    await expect(createDocumentAttachment(file, 'drop', FULL_BUDGET)).rejects.toBeInstanceOf(
      UnsupportedDocumentError,
    );
  });
});

describe('appendAttachedDocuments', () => {
  it('leaves the prompt untouched without documents', () => {
    expect(appendAttachedDocuments('hello', [])).toBe('hello');
    expect(appendAttachedDocuments('hello', undefined)).toBe('hello');
  });

  it('wraps inline text in CDATA', () => {
    const prompt = appendAttachedDocuments('hello', [{
      id: 'doc-1',
      name: 'notes.md',
      path: 'D:/vault/notes.md',
      mediaType: 'text/markdown',
      size: 2048,
      text: 'a < b & c',
      source: 'drop',
    }]);

    expect(prompt).toContain('<attached_files>');
    expect(prompt).toContain('name="notes.md"');
    expect(prompt).toContain('path="D:/vault/notes.md"');
    expect(prompt).toContain('<![CDATA[a < b & c]]>');
  });

  it('emits a self-closing element for binary attachments', () => {
    const prompt = appendAttachedDocuments('hello', [{
      id: 'doc-2',
      name: 'scan.pdf',
      path: 'C:/docs/scan.pdf',
      mediaType: 'application/pdf',
      size: 1048576,
      text: null,
      source: 'drop',
    }]);

    expect(prompt).toContain('<file name="scan.pdf" path="C:/docs/scan.pdf"');
    expect(prompt).toContain('/>');
    expect(prompt).toContain('binary attachment');
  });

  it('flags truncated content', () => {
    const prompt = appendAttachedDocuments('hello', [{
      id: 'doc-3',
      name: 'log.txt',
      mediaType: 'text/plain',
      size: 10,
      text: 'cut',
      truncated: true,
      source: 'drop',
    }]);

    expect(prompt).toContain('truncated="true"');
  });
});

describe('XML_CONTEXT_PATTERN', () => {
  it('recognizes attached_files blocks so display text stays clean', () => {
    const prompt = appendAttachedDocuments('hello', [{
      id: 'doc-4',
      name: 'notes.md',
      mediaType: 'text/markdown',
      size: 4,
      text: 'body',
      source: 'drop',
    }]);

    expect(XML_CONTEXT_PATTERN.test(prompt)).toBe(true);
    expect(prompt.slice(0, prompt.indexOf('\n\n<attached_files>'))).toBe('hello');
  });
});
