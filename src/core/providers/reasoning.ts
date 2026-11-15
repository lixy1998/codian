export const DEFAULT_REASONING_VALUE = 'high';
export const STANDARD_REASONING_VALUES = ['low', 'medium', 'high'] as const;

export function formatReasoningValueLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'xHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Chinese display labels for reasoning strength options. */
const REASONING_LABEL_ZH: Record<string, string> = {
  off: '关闭',
  none: '关闭',
  on: '开启',
  auto: '自动',
  minimal: '极低',
  low: '低',
  medium: '中',
  med: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  default: '默认',
};

/**
 * Chinese label for a reasoning strength option.
 *
 * Provider catalogs ship English names (for example DeepSeek's `On (default)`),
 * so the display layer translates by option value first and by label second.
 * Unrecognised values keep the provider's own label.
 */
export function localizeReasoningOptionLabel(option: { value: string; label: string }): string {
  const label = option.label?.trim() ?? '';
  const key = option.value?.trim().toLowerCase();
  let localized = key ? REASONING_LABEL_ZH[key] : undefined;

  if (!localized) {
    const base = label.toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim();
    localized = REASONING_LABEL_ZH[base];
  }

  if (!localized) {
    return label || formatReasoningValueLabel(option.value ?? '');
  }

  return /\(default\)/i.test(label) ? `${localized}（默认）` : localized;
}

export function resolvePreferredReasoningDefault(
  availableValues: readonly string[],
  fallbackValue: string,
): string {
  if (availableValues.includes(DEFAULT_REASONING_VALUE)) {
    return DEFAULT_REASONING_VALUE;
  }
  if (availableValues.includes(fallbackValue)) {
    return fallbackValue;
  }
  return availableValues[0] ?? fallbackValue;
}
