import type { Readable, Writable } from 'node:stream';

import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import type {
  AcpClientConnection,
  AcpLoadSessionResponse,
  AcpNewSessionResponse,
  AcpSessionConfigOption,
  AcpSubprocessLaunchSpec,
} from '../../acp';

export interface NativeAcpSubprocess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  isAlive(): boolean;
  onClose(listener: (error?: Error) => void): () => void;
  shutdown(): Promise<void>;
  start(): void;
}

export interface NativeAcpRuntimeOptions {
  args: string[];
  capabilities: ProviderCapabilities;
  createSubprocess?: (spec: AcpSubprocessLaunchSpec) => NativeAcpSubprocess;
  defaultCommand: string;
  /**
   * Sanitizes the final child-process environment before spawn. Providers whose CLI
   * reacts to inherited host variables (for example CODEBUDDY_* switches that force a
   * reduced bundle and silently disable ACP) supply this hook to strip them.
   *
   * `configuredEnvironment` holds only the entries the user set explicitly for this
   * provider, so an implementation can strip inherited noise while preserving values
   * the user really meant to pass (API keys, tokens).
   */
  prepareEnvironment?: (
    env: NodeJS.ProcessEnv,
    context: { configuredEnvironment: NodeJS.ProcessEnv },
  ) => NodeJS.ProcessEnv;
  providerId: ProviderId;
  sessionAdapter?: NativeAcpSessionAdapter;
}

export interface NativeAcpSessionAdapter {
  applySelections(params: {
    connection: AcpClientConnection;
    model?: string;
    sessionId: string;
  }): Promise<void>;
  formatStartError?(error: unknown): string;
  handleConfigOptions?(configOptions: AcpSessionConfigOption[], sessionId: string): Promise<void> | void;
  syncSessionConfig(
    source: AcpNewSessionResponse | (AcpLoadSessionResponse & { sessionId: string }),
  ): Promise<void>;
}
