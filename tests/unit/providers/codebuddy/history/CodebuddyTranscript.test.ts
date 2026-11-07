import { parseTranscript } from '@/providers/codebuddy/history/CodebuddyConversationHistoryService';

/** Minimal transcript: a user turn, a tool-before-answer run, then the answer and a footstep. */
const TRANSCRIPT = [
  { id: 'u1', type: 'message', role: 'user', timestamp: 1_000_000, content: 'analyse it' },
  { type: 'reasoning', timestamp: 1_003_000, rawContent: [{ type: 'reasoning_text', text: 'think' }] },
  { id: 'c1', type: 'function_call', timestamp: 1_003_000, callId: 'call-1', name: 'Bash', arguments: '{}' },
  { type: 'function_call_result', timestamp: 1_009_000, callId: 'call-1', status: 'success', output: 'ok' },
  {
    id: 'a1',
    type: 'message',
    role: 'assistant',
    timestamp: 1_010_000,
    content: [{ type: 'text', text: 'done' }],
  },
].map((record) => JSON.stringify(record)).join('\n');

describe('Codebuddy history transcript', () => {
  it('stamps every replay block with its transcript timestamp', () => {
    const messages = parseTranscript(TRANSCRIPT);
    const assistant = messages.find((message) => message.role === 'assistant');

    expect(assistant?.contentBlocks?.map((block) => [block.type, block.at])).toEqual([
      ['thinking', 1_003_000],
      ['tool_use', 1_003_000],
      ['text', 1_010_000],
    ]);
  });

  it('measures the process run from its first step to the answer that follows it', () => {
    const messages = parseTranscript(TRANSCRIPT);
    const blocks = messages.find((message) => message.role === 'assistant')?.contentBlocks ?? [];
    const runEnd = blocks.findIndex((block) => block.type === 'text');

    const seconds = Math.round(((blocks[runEnd].at ?? 0) - (blocks[0].at ?? 0)) / 1000);

    expect(seconds).toBe(7);
  });
});
