import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';

export const CODEBUDDY_PROVIDER_ID = 'codebuddy';

export interface CodebuddyDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface CodebuddyMode {
  description?: string;
  id: string;
  label: string;
}

export interface CodebuddyThinkingLevel {
  description?: string;
  label: string;
  value: string;
}

export interface CodebuddyProviderSettings {
  availableModes: CodebuddyMode[];
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  discoveredModels: CodebuddyDiscoveredModel[];
  discoveredThinkingLevels: CodebuddyThinkingLevel[];
  enabled: boolean;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  visibleModels: string[];
}

export const DEFAULT_CODEBUDDY_PROVIDER_SETTINGS: Readonly<CodebuddyProviderSettings> = Object.freeze({
  availableModes: [],
  cliPath: '',
  cliPathsByHost: {},
  discoveredModels: [],
  discoveredThinkingLevels: [],
  enabled: false,
  environmentVariables: '',
  modelAliases: {},
  visibleModels: [],
});

export function getCodebuddyProviderSettings(
  settings: Record<string, unknown> | null | undefined,
): CodebuddyProviderSettings {
  const config = getProviderConfig(settings ?? {}, CODEBUDDY_PROVIDER_ID);
  const discoveredModels = normalizeDiscoveredModels(config.discoveredModels);
  const discoveredIds = new Set(discoveredModels.map(model => model.rawId));

  return {
    availableModes: normalizeModes(config.availableModes),
    cliPath: readString(config.cliPath),
    cliPathsByHost: normalizeCliPaths(config.cliPathsByHost),
    discoveredModels,
    discoveredThinkingLevels: normalizeThinkingLevels(config.discoveredThinkingLevels),
    enabled: config.enabled === true,
    environmentVariables: readString(config.environmentVariables),
    modelAliases: normalizeAliases(config.modelAliases, discoveredIds),
    visibleModels: Array.isArray(config.visibleModels)
      ? normalizeStringList(config.visibleModels).filter(modelId => discoveredIds.has(modelId))
      : discoveredModels.map(model => model.rawId),
  };
}

export function updateCodebuddyProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CodebuddyProviderSettings>,
): CodebuddyProviderSettings {
  const current = getCodebuddyProviderSettings(settings);
  const next: CodebuddyProviderSettings = {
    ...current,
    ...updates,
    availableModes: normalizeModes(updates.availableModes ?? current.availableModes),
    cliPathsByHost: normalizeCliPaths(updates.cliPathsByHost ?? current.cliPathsByHost),
    discoveredModels: normalizeDiscoveredModels(updates.discoveredModels ?? current.discoveredModels),
    discoveredThinkingLevels: normalizeThinkingLevels(
      updates.discoveredThinkingLevels ?? current.discoveredThinkingLevels,
    ),
    modelAliases: normalizeAliases(
      updates.modelAliases ?? current.modelAliases,
      new Set(normalizeDiscoveredModels(updates.discoveredModels ?? current.discoveredModels)
        .map(model => model.rawId)),
    ),
    visibleModels: normalizeStringList(updates.visibleModels ?? current.visibleModels),
  };
  setProviderConfig(settings, CODEBUDDY_PROVIDER_ID, { ...next });
  return getCodebuddyProviderSettings(settings);
}

function normalizeDiscoveredModels(value: unknown): CodebuddyDiscoveredModel[] {
  if (!Array.isArray(value)) return [];
  const models = new Map<string, CodebuddyDiscoveredModel>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const rawId = readString(entry.rawId);
    const label = readString(entry.label);
    if (!rawId || !label) continue;
    const description = readString(entry.description);
    models.set(rawId, { ...(description ? { description } : {}), label, rawId });
  }
  return [...models.values()];
}

function normalizeThinkingLevels(value: unknown): CodebuddyThinkingLevel[] {
  if (!Array.isArray(value)) return [];
  const levels = new Map<string, CodebuddyThinkingLevel>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const levelValue = readString(entry.value);
    const label = readString(entry.label);
    if (!levelValue || !label) continue;
    const description = readString(entry.description);
    levels.set(levelValue, { ...(description ? { description } : {}), label, value: levelValue });
  }
  return [...levels.values()];
}

function normalizeModes(value: unknown): CodebuddyMode[] {
  if (!Array.isArray(value)) return [];
  const modes = new Map<string, CodebuddyMode>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = readString(entry.id);
    const label = readString(entry.label);
    if (!id || !label) continue;
    const description = readString(entry.description);
    modes.set(id, { ...(description ? { description } : {}), id, label });
  }
  return [...modes.values()];
}

function normalizeCliPaths(value: unknown): HostnameCliPaths {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
      .map(([host, cliPath]) => [host, cliPath.trim()]),
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean),
  )];
}

function normalizeAliases(value: unknown, modelIds: Set<string>): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => (
        modelIds.has(entry[0]) && typeof entry[1] === 'string' && Boolean(entry[1].trim())
      ))
      .map(([modelId, alias]) => [modelId, alias.trim()]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
