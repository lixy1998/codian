import { Notice, setIcon } from 'obsidian';

import { getEnabledProviderForModel } from '../../core/providers/modelRouting';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { localizeReasoningOptionLabel } from '../../core/providers/reasoning';
import type { ProviderReasoningOption } from '../../core/providers/types';
import type { ModelPickerCallbacks } from './types';

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

/**
 * Standalone reasoning-strength control: the trigger shows the current level and
 * clicking it opens its own popover. It is intentionally independent of the
 * model picker so the two concerns no longer share a nested menu.
 */
export class ThinkingSelector {
  private container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private currentEl: HTMLElement | null = null;
  private currentValueEl: HTMLElement | null = null;
  private optionsEl: HTMLElement | null = null;
  private callbacks: ModelPickerCallbacks;
  private floatingLayer: HTMLElement | null = null;
  private outsideClickListener: ((e: MouseEvent) => void) | null = null;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    parentEl: HTMLElement,
    callbacks: ModelPickerCallbacks,
    floatingLayer?: HTMLElement | null,
  ) {
    this.callbacks = callbacks;
    this.floatingLayer = floatingLayer ?? null;
    this.container = parentEl.createDiv({ cls: 'codian-thinking-selector' });
    this.render();

    this.outsideClickListener = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!this.container.contains(target) && !this.optionsEl?.contains(target)) {
        this.close();
      }
    };
    this.keydownListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        this.currentEl?.focus();
      }
    };

    const doc = this.container.ownerDocument ?? window.document;
    doc.addEventListener('click', this.outsideClickListener, true);
    doc.addEventListener('keydown', this.keydownListener, true);
  }

  destroy(): void {
    const doc = this.container.ownerDocument ?? window.document;
    if (this.outsideClickListener) {
      doc.removeEventListener('click', this.outsideClickListener, true);
      this.outsideClickListener = null;
    }
    if (this.keydownListener) {
      doc.removeEventListener('keydown', this.keydownListener, true);
      this.keydownListener = null;
    }
    if (this.floatingLayer && this.optionsEl) {
      this.optionsEl.remove();
    }
    this.optionsEl = null;
    this.container.empty();
  }

  isOpen(): boolean {
    return this.optionsEl?.classList.contains('visible') ?? false;
  }

  close(): void {
    if (this.optionsEl) {
      this.optionsEl.classList.remove('visible');
    }
    if (this.currentEl) {
      this.currentEl.classList.remove('active');
      this.currentEl.setAttribute('aria-expanded', 'false');
    }
  }

  open(): void {
    if (!this.optionsEl || !this.currentEl) return;
    this.renderEffortGears();
    this.positionPopover();

    this.optionsEl.classList.add('visible');
    this.currentEl.classList.add('active');
    this.currentEl.setAttribute('aria-expanded', 'true');
  }

  /**
   * Only the floating-layer variant needs explicit viewport coordinates; the
   * default variant is positioned by CSS against the trigger.
   */
  private positionPopover(): void {
    if (!this.optionsEl || !this.currentEl || !this.floatingLayer) return;
    const doc = this.currentEl.ownerDocument ?? window.document;
    const view = doc.defaultView;
    const rect = this.currentEl.getBoundingClientRect();
    const viewportHeight = view?.innerHeight ?? 768;

    this.optionsEl.setCssProps({
      '--codian-thinking-popover-left': `${Math.max(8, rect.left)}px`,
      '--codian-thinking-popover-bottom': `${Math.max(8, viewportHeight - rect.top + 6)}px`,
    });
  }

  private getCurrentEffortOptions(): ProviderReasoningOption[] {
    const settings = this.callbacks.getSettings();
    const providerId = settings.providerId
      ?? getEnabledProviderForModel(settings.model, settings);
    if (!ProviderRegistry.getRegisteredProviderIds().includes(providerId)) {
      return [];
    }
    const capabilities = ProviderRegistry.getCapabilities(providerId);
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, providerId);
    if (capabilities.reasoningControl !== 'effort'
      || !uiConfig.isAdaptiveReasoningModel(settings.model, providerSettings)) {
      return [];
    }
    return uiConfig.getReasoningOptions(settings.model, providerSettings);
  }

  private render(): void {
    this.container.empty();

    this.effortEl = this.container.createDiv({ cls: 'codian-thinking-effort' });

    this.currentEl = this.effortEl.createDiv({
      cls: 'codian-thinking-trigger',
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
    });
    this.currentEl.createSpan({ cls: 'codian-thinking-label-text', text: '思考强度' });
    this.currentValueEl = this.currentEl.createSpan({ cls: 'codian-thinking-current' });
    const chevronEl = this.currentEl.createSpan({ cls: 'codian-thinking-trigger-chevron' });
    setIcon(chevronEl, 'chevron-up');

    this.currentEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isOpen()) {
        this.close();
      } else {
        this.open();
      }
    });
    this.currentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
    });

    const optionsParent = this.floatingLayer ?? this.effortEl;
    this.optionsEl = optionsParent.createDiv({
      cls: 'codian-thinking-options',
      attr: { role: 'menu' },
    });

    this.updateDisplay();
  }

  updateDisplay(): void {
    const options = this.getCurrentEffortOptions();
    if (options.length <= 1) {
      this.container.addClass('codian-hidden');
      this.close();
      return;
    }

    this.container.removeClass('codian-hidden');
    const settings = this.callbacks.getSettings();
    const currentEffort = settings.reasoning;
    const currentInfo = options.find(e => e.value === currentEffort);
    const label = currentInfo
      ? localizeReasoningOptionLabel(currentInfo)
      : (options[0] ? localizeReasoningOptionLabel(options[0]) : '');
    this.currentValueEl?.setText(label);
    this.renderEffortGears();
  }

  private renderEffortGears(): void {
    if (!this.optionsEl) return;
    this.optionsEl.empty();

    const options = this.getCurrentEffortOptions();
    const settings = this.callbacks.getSettings();
    const currentEffort = settings.reasoning;

    this.optionsEl.createDiv({ cls: 'codian-thinking-popover-title', text: '思考强度' });

    for (const effort of options) {
      const gearEl = this.optionsEl.createDiv({
        cls: 'codian-thinking-gear',
        attr: { role: 'menuitemradio', 'aria-checked': 'false' },
      });
      gearEl.createSpan({ cls: 'codian-thinking-gear-label', text: localizeReasoningOptionLabel(effort) });
      if (effort.description) {
        gearEl.setAttribute('title', effort.description);
      }

      const checkEl = gearEl.createSpan({ cls: 'codian-thinking-gear-check' });
      if (effort.value === currentEffort) {
        gearEl.addClass('selected');
        gearEl.setAttribute('aria-checked', 'true');
        setIcon(checkEl, 'check');
      }

      gearEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        runToolbarAction(async () => {
          await this.callbacks.onEffortLevelChange(effort.value);
          this.updateDisplay();
        }, 'Failed to change effort level');
      });
    }
  }
}
