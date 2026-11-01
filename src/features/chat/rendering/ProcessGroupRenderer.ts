import { t } from '../../../i18n/i18n';
import { formatDurationMmSs } from '../../../utils/date';
import { collapseElement, setupCollapsible } from './collapsible';

/**
 * A collapsible container that groups the "process" steps of a turn
 * (thinking blocks, tool calls, subagent cards) into one disclosure.
 *
 * While the turn is streaming the group is expanded so the user can watch the
 * work happen; once the turn completes the group collapses into a single line
 * summary, leaving only the answer text visible. Clicking the header re-opens it.
 */
export interface ProcessGroupState {
  wrapperEl: HTMLElement;
  headerEl: HTMLElement;
  bodyEl: HTMLElement;
  labelEl: HTMLElement;
  stepCount: number;
  startTime: number;
  isExpanded: boolean;
  timerInterval: number | null;
  /** Set once a text block (answer) follows this group; later steps start a new group. */
  closed: boolean;
  /** True once finalize ran, so the timer never restarts. */
  finalized: boolean;
}

export interface ProcessGroupOptions {
  /** Expand while streaming (default: true). */
  initiallyExpanded?: boolean;
  /** Pre-set step count (used when replaying stored messages). */
  stepCount?: number;
  /** Pre-set elapsed seconds (used when replaying stored messages). */
  durationSeconds?: number;
  /** Start time override; defaults to now. */
  startTime?: number;
}

const ICON_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">'
  + '<path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a.75.75 0 0 1 .75.75c0 .9.55 1.6 1.28 2.26.62.56.97 1.2.97 2.06a3 3 0 1 1-6 0c0-.5.2-.96.5-1.34a.75.75 0 1 1 1.15.96.9.9 0 0 0-.15.38 1.5 1.5 0 1 0 3 0c0-.42-.15-.7-.55-1.06-.9-.82-1.7-1.86-1.7-3.26A.75.75 0 0 1 8 4.75Z"/></svg>';

/** Compute the header label for the current state. */
function buildLabel(state: ProcessGroupState, running: boolean, durationSeconds?: number): string {
  const count = Math.max(state.stepCount, 1);
  if (running) {
    const seconds = durationSeconds ?? Math.floor((Date.now() - state.startTime) / 1000);
    return t('chat.process.running', { count, seconds });
  }
  if (durationSeconds === undefined) {
    return t('chat.process.summary', { count });
  }
  return t('chat.process.completed', { count, duration: formatDurationMmSs(durationSeconds) });
}

function refreshLabel(state: ProcessGroupState, running: boolean, durationSeconds?: number): void {
  const text = buildLabel(state, running, durationSeconds);
  state.labelEl.setText(text);
  state.headerEl.setAttribute('aria-label', text);
}

export function createProcessGroup(
  parentEl: HTMLElement,
  options: ProcessGroupOptions = {},
): ProcessGroupState {
  const wrapperEl = parentEl.createDiv({ cls: 'codian-process-group' });
  if (options.initiallyExpanded !== false) {
    wrapperEl.addClass('codian-process-group--live');
  }

  const headerEl = wrapperEl.createDiv({ cls: 'codian-process-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createSpan({ cls: 'codian-process-icon' });
  iconEl.innerHTML = ICON_SVG;

  const labelEl = headerEl.createSpan({ cls: 'codian-process-label' });
  const chevronEl = headerEl.createSpan({ cls: 'codian-process-chevron' });
  chevronEl.setText('▾');

  const bodyEl = wrapperEl.createDiv({ cls: 'codian-process-body' });

  const startTime = options.startTime ?? Date.now();
  const state: ProcessGroupState = {
    wrapperEl,
    headerEl,
    bodyEl,
    labelEl,
    stepCount: options.stepCount ?? 0,
    startTime,
    isExpanded: options.initiallyExpanded !== false,
    timerInterval: null,
    closed: false,
    finalized: false,
  };

  const storedDuration = options.durationSeconds;
  const running = storedDuration === undefined;
  const initialLabel = buildLabel(state, running, storedDuration);
  labelEl.setText(initialLabel);

  setupCollapsible(wrapperEl, headerEl, bodyEl, state, {
    initiallyExpanded: state.isExpanded,
    baseAriaLabel: initialLabel,
  });

  if (running && options.initiallyExpanded !== false) {
    const view = parentEl.ownerDocument.defaultView ?? window;
    let seconds = 0;
    state.timerInterval = view.setInterval(() => {
      // Self-heal if the group was detached from the document (view switch, reset).
      if (!state.wrapperEl.isConnected) {
        stopTimer(state);
        return;
      }
      seconds += 1;
      if (state.finalized) return;
      refreshLabel(state, true, Math.max(seconds, Math.floor((Date.now() - startTime) / 1000)));
    }, 1000);
  }

  return state;
}

/** Register one process step (thinking block, tool call, subagent) in the group. */
export function addProcessStep(state: ProcessGroupState): void {
  state.stepCount += 1;
  if (!state.finalized) {
    refreshLabel(state, true);
  }
}

/** Stop the live timer for a group, if running. */
function stopTimer(state: ProcessGroupState): void {
  if (state.timerInterval === null) return;
  const view = state.wrapperEl.ownerDocument?.defaultView ?? window;
  view.clearInterval(state.timerInterval);
  state.timerInterval = null;
}

/**
 * Freeze the summary line without collapsing.
 * Used when answer text interrupts a run of steps mid-turn: that group is done,
 * but it stays open until the whole turn finishes.
 */
export function freezeProcessGroup(state: ProcessGroupState): void {
  stopTimer(state);
  if (state.bodyEl.childElementCount === 0) return;
  state.labelEl.setText(buildLabel(state, false, Math.floor((Date.now() - state.startTime) / 1000)));
}

/** Collapse the group and freeze its summary line. */
export function finalizeProcessGroup(state: ProcessGroupState): void {
  stopTimer(state);
  state.finalized = true;

  // Empty group (all steps were swallowed) — drop it so no stray line remains.
  if (state.bodyEl.childElementCount === 0) {
    state.wrapperEl.remove();
    return;
  }

  state.wrapperEl.removeClass('codian-process-group--live');
  const duration = Math.floor((Date.now() - state.startTime) / 1000);
  state.labelEl.setText(buildLabel(state, false, duration));
  collapseElement(state.wrapperEl, state.headerEl, state.bodyEl, state);
}

/** Drop the group entirely (e.g. state reset before its turn finished). */
export function disposeProcessGroup(state: ProcessGroupState): void {
  stopTimer(state);
  state.wrapperEl.remove();
}

/**
 * Replay a stored process group (loaded conversation): collapsed by default,
 * content is rendered lazily on first expand.
 */
export function renderStoredProcessGroup(
  parentEl: HTMLElement,
  renderChildren: (bodyEl: HTMLElement) => void,
  stepCount: number,
  durationSeconds?: number,
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'codian-process-group' });

  const headerEl = wrapperEl.createDiv({ cls: 'codian-process-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createSpan({ cls: 'codian-process-icon' });
  iconEl.innerHTML = ICON_SVG;

  const labelEl = headerEl.createSpan({ cls: 'codian-process-label' });
  const chevronEl = headerEl.createSpan({ cls: 'codian-process-chevron' });
  chevronEl.setText('▾');

  const bodyEl = wrapperEl.createDiv({ cls: 'codian-process-body' });

  const state = {
    wrapperEl,
    headerEl,
    bodyEl,
    labelEl,
    stepCount: stepCount ?? 0,
    startTime: Date.now(),
    isExpanded: false,
    timerInterval: null,
    closed: true,
    finalized: true,
  } satisfies ProcessGroupState;

  labelEl.setText(buildLabel(state, false, durationSeconds));

  // Render children up front (hidden inside the collapsed body) so expanding is instant.
  renderChildren(bodyEl);

  setupCollapsible(wrapperEl, headerEl, bodyEl, state, {
    initiallyExpanded: false,
    baseAriaLabel: buildLabel(state, false, durationSeconds),
  });

  return wrapperEl;
}
