import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { ChatMessage, Conversation, ToolCallInfo } from '../../../core/types';

/**
 * CodeBuddy keeps the transcript next to the CLI, one JSONL per session:
 * `~/.codebuddy/projects/<cwd-slug>/<sessionId>.jsonl`. Codian only stores metadata, so without
 * this service a restored conversation renders empty — the provider transcript is never read.
 *
 * The directory slug encodes the working directory, and the encoding is easy to get wrong
 * (`d:\Documents\TNote` becomes `d-Documents-TNote`). Rather than reimplement it, look the file up
 * by session id across the project folders: the id is globally unique, so a match is unambiguous.
 */
const PROJECTS_DIR = path.join(os.homedir(), '.codebuddy', 'projects');

function findSessionFile(sessionId: string): string | null {
  const fileName = `${sessionId}.jsonl`;
  try {
    for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(PROJECTS_DIR, entry.name, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // No provider storage yet, or it is unreadable: nothing to hydrate.
  }
  return null;
}

function blockText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const text = (value as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(blockText).filter(Boolean).join('\n');
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null) {
    const text = (output as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    try {
      return JSON.stringify(output);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Keeps conversational turns plus the tool calls that ran inside them. Reasoning and generated
 * titles are dropped — they add bulk without helping to recognise a conversation — but dropping
 * tool calls hides what the assistant actually did, leaving replies that mention work ("patch
 * applied", "pushed") with no visible steps behind them.
 */
function parseTranscript(raw: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const toolCallsByCallId = new Map<string, ToolCallInfo>();

  const startAssistant = (timestamp: number): ChatMessage => {
    const message: ChatMessage = {
      id: `codebuddy-history-${messages.length}`,
      role: 'assistant',
      content: '',
      timestamp,
    };
    messages.push(message);
    return message;
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const entry = record as {
      id?: unknown;
      role?: unknown;
      type?: unknown;
      timestamp?: unknown;
      content?: unknown;
      arguments?: unknown;
      callId?: unknown;
      name?: unknown;
      output?: unknown;
      status?: unknown;
    };
    const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();

    if (entry.type === 'message' && typeof entry.role === 'string') {
      const text = messageText(entry.content);
      if (!text.trim()) continue;
      messages.push({
        id: typeof entry.id === 'string' ? entry.id : `codebuddy-history-${messages.length}`,
        role: entry.role === 'user' ? 'user' : 'assistant',
        content: text,
        timestamp,
      });
      continue;
    }

    if (entry.type === 'function_call') {
      const owner = messages[messages.length - 1];
      const target = owner?.role === 'assistant' ? owner : startAssistant(timestamp);
      const callId = typeof entry.callId === 'string'
        ? entry.callId
        : (typeof entry.id === 'string' ? entry.id : `call-${toolCallsByCallId.size}`);
      const info: ToolCallInfo = {
        id: callId,
        name: typeof entry.name === 'string' ? entry.name : 'tool',
        input: parseArguments(entry.arguments),
        status: 'completed',
      };
      target.toolCalls = [...(target.toolCalls ?? []), info];
      toolCallsByCallId.set(callId, info);
      continue;
    }

    if (entry.type === 'function_call_result') {
      const callId = typeof entry.callId === 'string' ? entry.callId : '';
      const info = toolCallsByCallId.get(callId);
      if (!info) continue;
      info.result = outputText(entry.output);
      info.status = entry.status === 'error' || entry.status === 'failed' ? 'error' : 'completed';
    }
  }

  return messages.filter(message => (
    message.content.trim().length > 0 || (message.toolCalls?.length ?? 0) > 0
  ));
}

export class CodebuddyConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    _pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    if (conversation.messages.length > 0) {
      return;
    }
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      return;
    }
    const file = findSessionFile(sessionId);
    if (!file) {
      return;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const messages = parseTranscript(raw);
    if (messages.length > 0) {
      conversation.messages = messages;
    }
  }

  /**
   * Deliberately a no-op: the transcript belongs to the CLI. Deleting a Codian conversation must
   * not reach into the provider's own storage.
   */
  async deleteConversationSession(): Promise<void> {}

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(): Record<string, unknown> {
    return {};
  }
}
