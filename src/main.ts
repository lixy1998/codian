import { StartupProfiler } from './core/performance/StartupProfiler';
// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

StartupProfiler.finishModuleEvaluation();

import type { Editor, WorkspaceLeaf } from 'obsidian';
import { addIcon, MarkdownView, Notice, Plugin } from 'obsidian';

import { ConversationRepository } from './app/conversations/ConversationRepository';
import { CodianProviderHost } from './app/providers/CodianProviderHost';
import { DEFAULT_CODIAN_SETTINGS } from './app/settings/defaultSettings';
import type {
  ConditionalSettingsMutation,
  SettingsCommit,
} from './app/settings/SettingsCoordinator';
import {
  SettingsCoordinator,
  type SettingsMutation,
  SettingsPostCommitError,
} from './app/settings/SettingsCoordinator';
import { SharedStorageService } from './app/storage/SharedStorageService';
import type { SharedAppStorage } from './core/bootstrap/storage';
import { isValidTabManagerState } from './core/bootstrap/tabManagerState';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import {
  ProviderSettingsCoordinator,
  type SettingsReconciliationResult,
} from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolutionContext,
  ProviderId,
} from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import type {
  CodianSettings,
  Conversation,
  ConversationMeta,
  SessionMetadata,
} from './core/types';
import { compareConversationIndexOrder } from './core/types';
import {
  VIEW_TYPE_CODIAN,
} from './core/types';
import { CHAT_VIEW_PLACEMENTS, type ChatViewPlacement, type EnvironmentScope } from './core/types/settings';
import { CodianView } from './features/chat/CodianView';
import { LivePreviewComposerEnhancement } from './features/chat/composer/LivePreviewComposerEnhancement';
import type { ComposerEnhancement } from './features/chat/composer/types';
import { SearchConversationBrowserEnhancement } from './features/chat/conversation-browser/SearchConversationBrowserEnhancement';
import type { ConversationBrowserEnhancement } from './features/chat/conversation-browser/types';
import { registerFileMenu } from './features/chat/fileMenu';
import type { TabAttention } from './features/chat/state/types';
import { SessionRuntimePool } from './features/chat/tabs/SessionRuntimePool';
import { destroyTab } from './features/chat/tabs/Tab';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { CodianSettingTab } from './features/settings/CodianSettings';
import { t } from './i18n/i18n';
import { syncLocaleWithObsidian } from './i18n/obsidianLocale';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
import { CODIAN_RIBBON_ICON_ID, CODIAN_RIBBON_ICON_SVG } from './shared/codianLogo';
import { buildCursorContext } from './utils/editor';
import { CODIAN_HOVER_LINK_SOURCE } from './utils/fileLink';
import { resolveLoginShellPath } from './utils/loginShellPath';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

/** Destination names used by the per-placement "move chat view" commands. */
const CHAT_VIEW_PLACEMENT_LABEL_KEYS: Record<ChatViewPlacement, string> = {
  'right-sidebar': 'Right sidebar',
  'left-sidebar': 'Left sidebar',
  'main-tab': 'Main editor tab',
};

/**
 * Wraps one view instance's `load` so the callback runs right after the view
 * has rebuilt itself. WorkspaceLeaf loads the very instance it was given, which
 * lets the draft restore land before the new composer is ever painted.
 */
function hookInstanceLoad(
  view: CodianView & { load?: () => Promise<void> },
  afterLoad: (view: CodianView) => void,
): void {
  const originalLoad = view.load;
  if (typeof originalLoad !== 'function') return;

  const patched = function patchedLoad(this: CodianView) {
    const result = originalLoad.call(view);
    const restore = () => afterLoad(this);
    const settled = Promise.resolve(result).then(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    // Never re-install the wrapper: the view is loaded once per placement.
    view.load = originalLoad;
    return settled;
  };

  view.load = patched;
}

/** Unsent composer text of one tab, keyed by tab id. */
const RESTORE_DRAFT_INTERVAL_MS = 100;
const RESTORE_DRAFT_MAX_ATTEMPTS = 50;
/** Re-check delay: a restoring tab can overwrite the composer after the first write. */
const RESTORE_DRAFT_RECHECK_MS = 1500;

function collectComposerDrafts(view: CodianView): Map<string, string> {
  const drafts = new Map<string, string>();
  for (const tab of view.getTabManager()?.getAllTabs() ?? []) {
    const value = tab.dom.inputEl?.value;
    if (value) drafts.set(tab.id, value);
  }
  return drafts;
}

/**
 * A freshly restored tab may still be mounting (the conversation list is
 * loaded asynchronously), so the composer is polled until the text lands.
 */
function restoreComposerDraftsWhenReady(
  view: CodianView,
  drafts: Map<string, string>,
  onDone: () => void,
): void {
  if (drafts.size === 0) {
    onDone();
    return;
  }

  let finished = false;
  let attempts = 0;
  let observer: MutationObserver | null = null;
  let timer: number | null = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    if (timer !== null) window.clearTimeout(timer);
    onDone();
  };

  const apply = (): boolean => {
    const target = currentView() ?? view;
    const missing = new Set(drafts.keys());
    for (const tab of target.getTabManager()?.getAllTabs() ?? []) {
      const draft = drafts.get(tab.id);
      const inputEl = tab.dom.inputEl;
      if (!draft || !inputEl) continue;
      if (inputEl.value !== draft) setComposerDraft(inputEl, draft);
      if (inputEl.value === draft) missing.delete(tab.id);
    }
    if (missing.size === 0) {
      finish();
      return true;
    }
    return false;
  };

  // Entering the main area replaces the view instance, so the restore follows
  // whichever view currently hosts the chat and whichever leaf holds it.
  const currentView = (): CodianView | null => {
    for (const candidate of findCodianLeaves(view)) {
      if (isCodianView(candidate.view)) return candidate.view;
    }
    return null;
  };

  // The rebuilt view mounts its tabs asynchronously; watch every container the
  // chat can land in so the draft is written the moment the composer appears.
  observer = new MutationObserver(() => {
    if (apply()) finish();
  });
  for (const element of [view.containerEl, ...findCodianLeaves(view).map(l => (l.view as CodianView).containerEl)]) {
    if (element?.isConnected) observer.observe(element, { childList: true, subtree: true });
  }

  const tick = () => {
    if (apply()) return;
    if (++attempts > RESTORE_DRAFT_MAX_ATTEMPTS) {
      const target = currentView() ?? view;
      console.warn('[Codian] could not restore the unsent draft', {
        drafts: [...drafts.entries()],
        tabs: (target.getTabManager()?.getAllTabs() ?? []).map(t => ({
          id: t.id,
          hasInput: !!t.dom?.inputEl,
        })),
      });
      finish();
      return;
    }
    timer = window.setTimeout(tick, RESTORE_DRAFT_INTERVAL_MS);
  };

  window.requestAnimationFrame(tick);
}

function setComposerDraft(inputEl: HTMLTextAreaElement, draft: string): void {
  inputEl.value = draft;
  inputEl.selectionStart = draft.length;
  inputEl.selectionEnd = draft.length;
  const EventConstructor = inputEl.ownerDocument.defaultView?.Event ?? Event;
  inputEl.dispatchEvent(new EventConstructor('input', { bubbles: true }));
}

function isCodianView(value: unknown): value is CodianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

/** Every leaf currently hosting a Codian view, in workspace order. */
function findCodianLeaves(within: CodianView): WorkspaceLeaf[] {
  const leaves = within.app.workspace.getLeavesOfType(VIEW_TYPE_CODIAN);
  return leaves.length > 0 ? leaves : [];
}

function readPendingProviderSessionInvalidations(
  settings: Record<string, unknown>,
): Map<ProviderId, number> {
  const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
  const value = settings.pendingProviderSessionInvalidations;
  const pending = new Map<ProviderId, number>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return pending;
  }

  for (const [providerId, generation] of Object.entries(value)) {
    if (
      registeredProviderIds.has(providerId)
      && typeof generation === 'number'
      && Number.isSafeInteger(generation)
      && generation > 0
    ) {
      pending.set(providerId, generation);
    }
  }
  return pending;
}

function serializePendingProviderSessionInvalidations(
  pending: ReadonlyMap<ProviderId, number>,
): Partial<Record<string, number>> {
  return Object.fromEntries(
    Array.from(pending.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function hasSamePendingProviderSessionInvalidations(
  value: unknown,
  pending: ReadonlyMap<ProviderId, number>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return entries.length === pending.size
    && entries.every(([providerId, generation]) => pending.get(providerId) === generation);
}

export default class CodianPlugin extends Plugin {
  settings!: CodianSettings;
  storage!: SharedAppStorage;
  readonly sessionRuntimePool = new SessionRuntimePool(tab => destroyTab(tab));
  readonly providerHost = new CodianProviderHost(this);
  private readonly composerEnhancement: ComposerEnhancement = new LivePreviewComposerEnhancement();
  private readonly conversationBrowserEnhancement: ConversationBrowserEnhancement = new SearchConversationBrowserEnhancement();
  private settingsCoordinator!: SettingsCoordinator<CodianSettings>;
  private conversationRepository!: ConversationRepository;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private pendingSessionMetadataScan = false;
  private pendingEnvironmentInvalidationGenerations = new Map<ProviderId, number>();
  private blockedEnvironmentInvalidationGenerations = new Map<ProviderId, number>();
  private environmentUpdateTail: Promise<void> = Promise.resolve();
  private agentSkillResourceGeneration = 0;
  private isLoadingRemainingSessionMetadata = false;
  private hasLoadedAllSessionMetadata = false;
  private sessionMetadataLoadTimer: number | null = null;
  private remainingSessionMetadataLoad: Promise<void> | null = null;
  private isUnloading = false;
  private settingsReady: Promise<void> | null = null;

  /**
   * Resolves once `loadSettings()` has populated `this.settings`, `this.storage`
   * and `this.conversationRepository`. `onload` no longer awaits the settings
   * load (see the comment there), so every entry point that touches settings
   * must gate on this first.
   */
  private async whenSettingsReady(): Promise<void> {
    if (this.settingsReady) {
      await this.settingsReady;
    }
    if (!this.settings) {
      throw new Error('Codian settings are not initialized yet.');
    }
  }

  /**
   * Lets tests (and anything else that needs a settled plugin) await the
   * deferred settings load that `onload` deliberately does not wait for.
   * `whenSettingsReady` throws before the load has been scheduled, so this
   * waits for that scheduling first.
   */
  async waitForSettingsReady(): Promise<void> {
    if (!this.settingsReady) {
      await Promise.resolve();
    }
    if (!this.settingsReady) return;
    await this.whenSettingsReady();
  }

  async onload() {
    StartupProfiler.startOnload();
    try {
      // Deliberately NOT awaited. loadSettings() performs real vault I/O: the
      // data.json read, a recursive scan of the legacy .codian storage, the
      // restored-session metadata reads and possibly metadata writes. Awaiting
      // it yields to the macrotask queue *before* Obsidian clears its per-plugin
      // 3s hang timer, so the startup screen reports "Plugin Codian is taking
      // long to load" even though the measured work is under 100ms. Keeping
      // onload synchronous lets Obsidian clear that timer in the same microtask
      // turn that resolves the plugin load.
      // Anything that reads `this.settings` must go through whenSettingsReady().
      this.settingsReady = StartupProfiler.runAsync(
        'settings-load',
        () => this.loadSettings({ deferNonRestoredSessionMetadata: true }),
      ).then(() => {
        this.addSettingTab(new CodianSettingTab(this.app, this));
        this.scheduleRemainingSessionMetadataLoad();
      }).catch((error: unknown) => {
        console.error('[Codian] settings initialization failed', error);
      });
      // Provider workspace services are initialized lazily on first use.

      // Let the Page preview core plugin handle hovering over links in messages.
      this.registerHoverLinkSource(CODIAN_HOVER_LINK_SOURCE, {
        display: 'Codian',
        defaultMod: false,
      });

      this.registerView(
        VIEW_TYPE_CODIAN,
        (leaf) => new CodianView(leaf, this)
      );
      registerFileMenu(this);

      addIcon(CODIAN_RIBBON_ICON_ID, CODIAN_RIBBON_ICON_SVG);
      this.addRibbonIcon(CODIAN_RIBBON_ICON_ID, 'Open codian', () => {
        void this.activateView();
      });

      this.addCommand({
        id: 'open-view',
        name: 'Open chat view',
        callback: () => {
          void this.activateView();
        },
      });

      this.addCommand({
        id: 'toggle-view-placement',
        name: 'Toggle chat placement (sidebar / main tab)',
        callback: async () => {
          await this.toggleViewPlacement();
        },
      });

      for (const placement of CHAT_VIEW_PLACEMENTS) {
        this.addCommand({
          id: `move-view-to-${placement}`,
          name: `Move chat view to ${CHAT_VIEW_PLACEMENT_LABEL_KEYS[placement]}`,
          callback: async () => {
            await this.moveViewToPlacement(placement, { force: true });
          },
        });
      }

      this.addCommand({
        id: 'inline-edit',
        name: 'Inline edit',
        editorCallback: async (editor: Editor, ctx) => {
          const view = ctx instanceof MarkdownView
            ? ctx
            : this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view) {
            new Notice('Inline edit unavailable: could not access the active Markdown view.');
            return;
          }

          const selectedText = editor.getSelection();
          const notePath = view.file?.path || 'unknown';

          let editContext: InlineEditContext;
          if (selectedText.trim()) {
            editContext = { mode: 'selection', selectedText };
          } else {
            const cursor = editor.getCursor();
            const cursorContext = buildCursorContext(
              (line) => editor.getLine(line),
              editor.lineCount(),
              cursor.line,
              cursor.ch
            );
            editContext = { mode: 'cursor', cursorContext };
          }

          const modal = new InlineEditModal(
            this.app,
            this,
            editor,
            view,
            editContext,
            notePath,
            () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
          );
          const result = await modal.openAndWait();

          if (result.decision === 'accept' && result.editedText !== undefined) {
            new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
          }
        },
      });

      this.addCommand({
        id: 'new-tab',
        name: 'New tab',
        checkCallback: (checking: boolean) => {
          if (!this.canCreateNewTab()) return false;

          if (!checking) {
            void this.openNewTab();
          }
          return true;
        },
      });

      this.addCommand({
        id: 'new-session',
        name: 'New session (in current tab)',
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;

          const activeTab = tabManager.getActiveTab();
          if (!activeTab) return false;

          if (activeTab.state.isStreaming) return false;

          if (!checking) {
            void tabManager.createNewConversation();
          }
          return true;
        },
      });

      this.addCommand({
        id: 'close-current-tab',
        name: 'Close current tab',
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;

          if (!checking) {
            const activeTabId = tabManager.getActiveTabId();
            if (activeTabId) {
              void tabManager.closeTab(activeTabId);
            }
          }
          return true;
        },
      });

      this.addCommand({
        id: 'copy-startup-diagnostics',
        name: 'Copy startup diagnostics',
        callback: async () => {
          const copied = await StartupProfiler.copyToClipboard();
          new Notice(copied ? 'Startup diagnostics copied to clipboard.' : 'Failed to copy startup diagnostics.');
        },
      });

      // Started early so the first provider launch rarely waits for the shell.
      if (typeof this.app.workspace.onLayoutReady === 'function') {
        this.app.workspace.onLayoutReady(() => { void resolveLoginShellPath(); });
      } else {
        void resolveLoginShellPath();
      }
    } finally {
      StartupProfiler.finishOnload();
    }
  }

  onunload(): void {
    this.isUnloading = true;
    this.sessionRuntimePool.beginShutdown();
    if (this.sessionMetadataLoadTimer !== null) {
      window.clearTimeout(this.sessionMetadataLoadTimer);
      this.sessionMetadataLoadTimer = null;
    }
    StartupProfiler.freeze();
    void this.persistOpenTabStates().catch(() => undefined);
    void (async () => {
      await Promise.allSettled(this.getAllViews().map(view => view.disposeSessions?.()));
      await this.sessionRuntimePool.dispose();
      await ProviderWorkspaceRegistry.disposeInitialized();
    })();
  }

  private async persistOpenTabStates(): Promise<void> {
    for (const view of this.getAllViews()) {
      const state = view.getPersistedTabState();
      if (state) {
        await this.persistTabManagerState(state);
      }
    }
  }

  async activateView() {
    await this.whenSettingsReady();
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CODIAN)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_CODIAN,
          active: true,
        });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  /**
   * Moves the chat view to a different workspace location and remembers the
   * destination as the open placement.
   *
   * Sidebar and main-area leaves live in different workspace trees and a leaf
   * cannot be moved between them, so Obsidian has to rebuild the view there.
   * The open conversations are restored from the persisted tab state, and the
   * unsent drafts are carried over by hand — they only live in the input DOM.
   */
  async moveViewToPlacement(placement: ChatViewPlacement, options: { force?: boolean } = {}): Promise<boolean> {
    await this.whenSettingsReady();
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(VIEW_TYPE_CODIAN)[0];

    if (!leaf) {
      await this.mutateSettings((settings) => {
        settings.chatViewPlacement = placement;
      });
      await this.activateView();
      return true;
    }

    if (!options.force && this.getPlacementOfLeaf(leaf) === placement) {
      await revealWorkspaceLeaf(workspace, leaf);
      return false;
    }

    const view = leaf.view as CodianView | undefined;
    if (!view) {
      await revealWorkspaceLeaf(workspace, leaf);
      return false;
    }

    const drafts = collectComposerDrafts(view);
    const tabState = view.getPersistedTabState?.() ?? null;
    if (tabState) {
      await this.persistTabManagerState(tabState);
    }

    const target = this.getLeafForPlacement(placement);
    if (!target) {
      await revealWorkspaceLeaf(workspace, leaf);
      return false;
    }

    // Drafts have to be restored after the rebuild: entering the main area
    // replaces the view instance, and the restore follows whatever view owns
    // the chat at the time it runs.
    const restoreOnLoad = (movedView: CodianView) => {
      restoreComposerDraftsWhenReady(movedView, drafts, () => undefined);
    };
    hookInstanceLoad(view as CodianView & { load?: () => Promise<void> }, restoreOnLoad);

    const viewState = { ...leaf.getViewState(), type: view.getViewType() };
    const navigationState = {} as Record<string, unknown>;
    await target.setViewState(viewState, navigationState);

    const movedLeaf = workspace.getLeavesOfType(VIEW_TYPE_CODIAN)
      .find(candidate => candidate.getRoot?.() !== leaf.getRoot?.()) ?? target;
    if (movedLeaf !== leaf && leaf.parent) {
      await leaf.detach();
    }

    await revealWorkspaceLeaf(workspace, movedLeaf);

    // A tab that is still restoring its last message can overwrite the
    // composer after the first successful write, so the draft is re-checked
    // once more after the turn has settled. The view is looked up from the
    // workspace each time: entering the main area can swap the instance.
    restoreComposerDraftsWhenReady(this.getView() ?? view, drafts, () => {
      window.setTimeout(() => {
        const current = this.getView();
        if (current) restoreComposerDraftsWhenReady(current, drafts, () => undefined);
      }, RESTORE_DRAFT_RECHECK_MS);
    });
    await this.mutateSettings((settings) => {
      settings.chatViewPlacement = placement;
    });
    return true;
  }

  /**
   * Reflected placement of the leaf currently hosting the chat view.
   *
   * `leaf.parent` is the tab group inside a split, never the split itself, so
   * the placement has to be read from the split a leaf is rooted in.
   */
  getCurrentViewPlacement(): ChatViewPlacement | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODIAN)[0];
    return leaf ? this.getPlacementOfLeaf(leaf) : null;
  }

  private getPlacementOfLeaf(leaf: WorkspaceLeaf): ChatViewPlacement | null {
    const { workspace } = this.app;
    const root = typeof leaf.getRoot === 'function' ? leaf.getRoot() : leaf.parent?.parent ?? leaf.parent;
    if (!root) return null;
    if (root === workspace.leftSplit) return 'left-sidebar';
    if (root === workspace.rightSplit) return 'right-sidebar';
    return 'main-tab';
  }

  private async toggleViewPlacement(): Promise<void> {
    const current = this.getCurrentViewPlacement() ?? this.settings.chatViewPlacement;
    const sidebarPlacement: ChatViewPlacement = current === 'left-sidebar' ? 'right-sidebar' : 'left-sidebar';
    const next: ChatViewPlacement = current === 'main-tab' ? sidebarPlacement : 'main-tab';
    await this.moveViewToPlacement(next, { force: true });
  }

  private canCreateNewTab(): boolean {
    const hasCodianLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODIAN).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasCodianLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<CodianView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  async loadSettings(options: { deferNonRestoredSessionMetadata?: boolean } = {}) {
    this.hasLoadedAllSessionMetadata = false;
    this.storage = new SharedStorageService(this);
    const { codianz, migratedLegacyPluginData } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_CODIAN_SETTINGS,
      ...codianz,
    };
    this.settingsCoordinator = new SettingsCoordinator(
      this.settings,
      async (settings) => {
        ProviderSettingsCoordinator.normalizeProviderSelection(settings);
        ProviderSettingsCoordinator.persistProjectedProviderState(settings);
        await this.storage.saveCodianSettings(settings);
      },
    );
    const didNormalizePendingSessionInvalidations = this.syncPendingSessionInvalidations();
    this.conversationRepository = new ConversationRepository({
      getSettings: () => this.settings,
      getVaultPath: () => getVaultPath(this.app),
      sessions: this.storage.sessions,
      onConversationDeleted: (conversationId) => this.resetDeletedConversationTabs(conversationId),
      createConversationPreview: conversation => (
        this.getConversationBrowserEnhancement()?.createPreview(conversation)
      ),
    });

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost)
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    if (
      this.settings.savedProviderPermissionMode
      && typeof this.settings.savedProviderPermissionMode === 'object'
      && !Array.isArray(this.settings.savedProviderPermissionMode)
    ) {
      for (const [providerId, mode] of Object.entries(this.settings.savedProviderPermissionMode)) {
        if (mode === 'plan') {
          this.settings.savedProviderPermissionMode[providerId] = 'normal';
        }
      }
    }
    const opencodeConfig = this.settings.providerConfigs?.opencode;
    if (
      opencodeConfig
      && typeof opencodeConfig === 'object'
      && !Array.isArray(opencodeConfig)
      && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
    ) {
      opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
    }

    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const deferRemainingMetadata = options.deferNonRestoredSessionMetadata === true;
    const initialMetadataScan = await StartupProfiler.runAsync(
      deferRemainingMetadata ? 'restored-session-metadata-load' : 'session-metadata-load',
      async () => deferRemainingMetadata
        ? {
          metadata: await this.loadRestoredSessionMetadata(),
          complete: false,
          invalidMetadataCount: 0,
        }
        : this.storage.sessions.scanMetadata(),
    );
    const initialMetadata = initialMetadataScan.metadata;
    StartupProfiler.recordCount('restored-session-metadata-count', initialMetadata.length);
    StartupProfiler.recordCount('session-metadata-count', initialMetadata.length);
    StartupProfiler.recordCount(
      'invalid-session-metadata-count',
      initialMetadataScan.invalidMetadataCount,
    );
    this.conversationRepository.replaceAll(initialMetadata.map(meta => (
      this.createConversationMetadataShell(meta)
    )).sort(compareConversationIndexOrder));
    syncLocaleWithObsidian();
    if (migratedLegacyPluginData) {
      new Notice(t('common.legacyPluginDataMigrated'));
    }

    const backfilledConversations = this.conversationRepository.backfillResponseTimestamps();

    const reconciliation = this.reconcileModelWithEnvironment();
    this.markPendingSessionInvalidations(
      this.settings,
      reconciliation.sessionInvalidationProviderIds,
    );
    const pendingInvalidatedConversations = ProviderSettingsCoordinator
      .invalidateConversationSessions(
        this.conversationRepository.getAll(),
        Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
      );
    const completedInvalidationGenerations = initialMetadataScan.complete
      ? new Map(this.pendingEnvironmentInvalidationGenerations)
      : new Map<ProviderId, number>();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (
      reconciliation.changed
      || didNormalizeModelVariants
      || didNormalizeProviderSelection
      || didNormalizePendingSessionInvalidations
    ) {
      await this.saveSettings();
    }

    const conversationsToSave = new Set([
      ...backfilledConversations,
      ...reconciliation.invalidatedConversations,
      ...pendingInvalidatedConversations,
    ]);
    for (const conv of conversationsToSave) {
      await this.storage.sessions.saveMetadata(
        this.storage.sessions.toSessionMetadata(conv)
      );
    }
    await this.completePendingSessionInvalidations(completedInvalidationGenerations);
    this.hasLoadedAllSessionMetadata = initialMetadataScan.complete;
    this.pendingSessionMetadataScan = deferRemainingMetadata;
  }

  private async loadRestoredSessionMetadata(): Promise<SessionMetadata[]> {
    const restoredConversationIds = Array.from(new Set(
      (this.lastKnownTabManagerState?.openTabs ?? [])
        .map(({ conversationId }) => conversationId)
        .filter((conversationId): conversationId is string => conversationId !== null),
    ));
    const metadata = await Promise.all(
      restoredConversationIds.map(id => this.storage.sessions.loadMetadata(id)),
    );
    return metadata.filter((item): item is SessionMetadata => item !== null);
  }

  private scheduleRemainingSessionMetadataLoad(): void {
    if (!this.pendingSessionMetadataScan || this.isUnloading) {
      return;
    }

    const schedule = (): void => {
      if (!this.pendingSessionMetadataScan || this.isUnloading) {
        return;
      }
      this.sessionMetadataLoadTimer = window.setTimeout(() => {
        this.sessionMetadataLoadTimer = null;
        this.startRemainingSessionMetadataLoad();
      }, 0);
    };

    if (typeof this.app.workspace.onLayoutReady === 'function') {
      this.app.workspace.onLayoutReady(schedule);
    } else {
      schedule();
    }
  }

  private startRemainingSessionMetadataLoad(): void {
    if (
      !this.pendingSessionMetadataScan
      || this.isUnloading
      || this.remainingSessionMetadataLoad
    ) {
      return;
    }

    this.pendingSessionMetadataScan = false;
    const load = StartupProfiler.runAsync(
      'session-metadata-background-load',
      () => this.loadRemainingSessionMetadata(),
    ).catch(() => {
      StartupProfiler.increment('session-metadata-background-failures');
    }).finally(() => {
      if (this.remainingSessionMetadataLoad === load) {
        this.remainingSessionMetadataLoad = null;
      }
    });
    this.remainingSessionMetadataLoad = load;
  }

  private async loadRemainingSessionMetadata(): Promise<void> {
    this.isLoadingRemainingSessionMetadata = true;
    try {
      const addedConversations: Conversation[] = [];
      const invalidatedConversations: Conversation[] = [];
      const publishBatch = (metadata: SessionMetadata[]): void => {
        if (this.isUnloading || metadata.length === 0) return;

        const shells = metadata.map(meta => this.createConversationMetadataShell(meta));
        const invalidatedShells = ProviderSettingsCoordinator.invalidateConversationSessions(
          shells,
          Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
        );
        const invalidatedIds = new Set(invalidatedShells.map(({ id }) => id));
        const added = this.conversationRepository.mergeMetadataConversations(shells);
        if (added.length === 0) return;

        addedConversations.push(...added);
        invalidatedConversations.push(
          ...added.filter(conversation => invalidatedIds.has(conversation.id)),
        );
        for (const view of this.getAllViews()) {
          view.notifyConversationListChanged();
        }
      };
      const scan = await this.storage.sessions.scanMetadata({ onBatch: publishBatch });
      if (this.isUnloading) {
        return;
      }

      const allMetadata = scan.metadata;
      StartupProfiler.recordCount('session-metadata-count', allMetadata.length);
      StartupProfiler.recordCount(
        'invalid-session-metadata-count',
        scan.invalidMetadataCount,
      );
      // Custom storage implementations may not support incremental publication yet.
      publishBatch(allMetadata);
      const currentAddedConversations = addedConversations.filter((conversation) => (
        this.conversationRepository.getCachedConversation(conversation.id) === conversation
      ));
      StartupProfiler.recordCount('background-session-metadata-count', currentAddedConversations.length);
      for (const conversation of invalidatedConversations) {
        if (this.conversationRepository.getCachedConversation(conversation.id) !== conversation) {
          continue;
        }
        await this.storage.sessions.saveMetadata(
          this.storage.sessions.toSessionMetadata(conversation),
        );
      }
      if (scan.complete) {
        this.hasLoadedAllSessionMetadata = true;
        if (!this.isUnloading) {
          await this.completePendingSessionInvalidations(
            this.getCompletablePendingSessionInvalidations(),
          );
        }
      }
    } finally {
      this.isLoadingRemainingSessionMetadata = false;
    }
  }

  private syncPendingSessionInvalidations(): boolean {
    const pending = readPendingProviderSessionInvalidations(this.settings);
    const changed = !hasSamePendingProviderSessionInvalidations(
      this.settings.pendingProviderSessionInvalidations,
      pending,
    );
    this.settings.pendingProviderSessionInvalidations =
      serializePendingProviderSessionInvalidations(pending);
    this.pendingEnvironmentInvalidationGenerations = pending;
    return changed;
  }

  private markPendingSessionInvalidations(
    settings: CodianSettings,
    providerIds: ProviderId[],
  ): Map<ProviderId, number> {
    const marked = this.stagePendingSessionInvalidations(settings, providerIds);
    this.commitPendingSessionInvalidations(marked);
    return marked;
  }

  private stagePendingSessionInvalidations(
    settings: CodianSettings,
    providerIds: ProviderId[],
  ): Map<ProviderId, number> {
    const pending = readPendingProviderSessionInvalidations(settings);
    const marked = new Map<ProviderId, number>();
    for (const providerId of new Set(providerIds)) {
      const previousGeneration = Math.max(
        pending.get(providerId) ?? 0,
        this.pendingEnvironmentInvalidationGenerations.get(providerId) ?? 0,
      );
      const generation = Math.max(Date.now(), previousGeneration + 1);
      pending.set(providerId, generation);
      marked.set(providerId, generation);
    }
    settings.pendingProviderSessionInvalidations =
      serializePendingProviderSessionInvalidations(pending);
    return marked;
  }

  private commitPendingSessionInvalidations(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      this.pendingEnvironmentInvalidationGenerations.set(providerId, generation);
    }
  }

  private blockEnvironmentInvalidationCompletion(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      this.blockedEnvironmentInvalidationGenerations.set(providerId, generation);
    }
  }

  private releaseEnvironmentInvalidationCompletion(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      if (this.blockedEnvironmentInvalidationGenerations.get(providerId) === generation) {
        this.blockedEnvironmentInvalidationGenerations.delete(providerId);
      }
    }
  }

  private getCompletablePendingSessionInvalidations(): Map<ProviderId, number> {
    return new Map(Array.from(
      this.pendingEnvironmentInvalidationGenerations,
      ([providerId, generation]) => [providerId, generation] as const,
    ).filter(([providerId, generation]) => (
      this.blockedEnvironmentInvalidationGenerations.get(providerId) !== generation
    )));
  }

  private async completePendingSessionInvalidations(
    completedGenerations: ReadonlyMap<ProviderId, number>,
  ): Promise<void> {
    if (completedGenerations.size === 0) {
      return;
    }

    const removed = new Map<ProviderId, number>();
    try {
      await this.mutateSettingsConditionally((settings) => {
        const pending = readPendingProviderSessionInvalidations(settings);
        for (const [providerId, generation] of completedGenerations) {
          if (pending.get(providerId) === generation) {
            pending.delete(providerId);
            removed.set(providerId, generation);
          }
        }
        if (removed.size === 0) {
          return false;
        }
        settings.pendingProviderSessionInvalidations =
          serializePendingProviderSessionInvalidations(pending);
        return true;
      });
    } catch (error) {
      const pending = readPendingProviderSessionInvalidations(this.settings);
      for (const [providerId, generation] of removed) {
        if (this.pendingEnvironmentInvalidationGenerations.get(providerId) === generation) {
          pending.set(providerId, generation);
        }
      }
      this.settings.pendingProviderSessionInvalidations =
        serializePendingProviderSessionInvalidations(pending);
      throw error;
    }

    for (const [providerId, generation] of removed) {
      if (this.pendingEnvironmentInvalidationGenerations.get(providerId) === generation) {
        this.pendingEnvironmentInvalidationGenerations.delete(providerId);
      }
    }
  }

  private createConversationMetadataShell(meta: SessionMetadata): Conversation {
    return {
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      title: meta.title,
      preview: meta.preview,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastResponseAt: meta.lastResponseAt,
      sessionId: meta.sessionId !== undefined ? meta.sessionId : meta.id,
      selectedModel: meta.selectedModel,
      providerState: meta.providerState,
      messages: [],
      currentNote: meta.currentNote,
      externalContextPaths: meta.externalContextPaths,
      enabledMcpServers: meta.enabledMcpServers,
      usage: meta.usage,
      titleGenerationStatus: meta.titleGenerationStatus,
      resumeAtMessageId: meta.resumeAtMessageId,
      pinned: meta.pinned,
      archived: meta.archived,
    };
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async saveSettings() {
    await this.settingsCoordinator.persistCurrent();
  }

  async mutateSettings(
    mutation: SettingsMutation<CodianSettings>,
    onCommitted?: SettingsCommit<CodianSettings>,
  ): Promise<void> {
    await this.settingsCoordinator.mutate(mutation, onCommitted);
  }

  getCommittedSettings(): Readonly<CodianSettings> {
    return this.settingsCoordinator.getCommittedSettings();
  }

  getAgentSkillResourceGeneration(): number {
    return this.agentSkillResourceGeneration;
  }

  async notifyAgentSkillsChanged(): Promise<void> {
    const providerIds = ProviderRegistry.getRegisteredProviderIds().filter(providerId => (
      ProviderRegistry.getCapabilities(providerId).supportsSharedAgentSkills === true
    ));
    const generation = ++this.agentSkillResourceGeneration;

    for (const view of this.getAllViews()) {
      view.invalidateProviderResources(providerIds, generation);
    }

    await ProviderWorkspaceRegistry.getIfInitialized('codex')?.commandCatalog?.refresh();
    await ProviderWorkspaceRegistry.getIfInitialized('deepseek')?.commandCatalog?.refresh();
  }

  async mutateSettingsConditionally(
    mutation: ConditionalSettingsMutation<CodianSettings>,
  ): Promise<void> {
    await this.settingsCoordinator.mutateConditionally(mutation);
  }

  async mutateProviderSettingsAndRecycleRuntimes(
    providerId: ProviderId,
    mutation: SettingsMutation<CodianSettings>,
  ): Promise<void> {
    const transition = await ProviderWorkspaceRegistry
      .beginAuxiliaryServicesEnvironmentChange([providerId]);
    const errors: unknown[] = [];
    try {
      await this.quiesceEnvironmentAffectedRuntimes([providerId]);
      await this.mutateSettings(mutation, () => {
        ProviderWorkspaceRegistry.getCliResolver(providerId)?.reset();
      });
      for (const view of this.getAllViews()) {
        await view.getTabManager()?.recycleProviderRuntimes(providerId);
        view.invalidateProviderCommandCaches?.([providerId]);
        view.refreshModelSelector?.();
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      await transition.release();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, `Failed to update ${providerId} runtime settings.`);
    }
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const queuedUpdates = updates.map(update => ({ ...update }));
    const apply = this.environmentUpdateTail.then(
      () => this.applyEnvironmentVariablesBatchNow(queuedUpdates),
    );
    this.environmentUpdateTail = apply.catch(() => undefined);
    await apply;
  }

  private async applyEnvironmentVariablesBatchNow(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    const changedScopes = [...nextEnvironmentByScope].flatMap(([scope, envText]) => (
      getScopedEnvironmentVariables(
        this.settings as unknown as Record<string, unknown>,
        scope,
      ) === envText
        ? []
        : [scope]
    ));
    const providersToQuiesce = this.getAffectedEnvironmentProviders(changedScopes);
    let auxiliaryTransition: Awaited<ReturnType<
      typeof ProviderWorkspaceRegistry.beginAuxiliaryServicesEnvironmentChange
    >> | null = null;
    let affectedProviderIds: ProviderId[] = [];
    let sessionInvalidationProviderIds: ProviderId[] = [];
    let invalidationGenerations = new Map<ProviderId, number>();
    let invalidationPublished = false;
    let settingsCommitted = false;
    const errors: unknown[] = [];
    try {
      if (providersToQuiesce.length > 0) {
        auxiliaryTransition = await ProviderWorkspaceRegistry
          .beginAuxiliaryServicesEnvironmentChange(providersToQuiesce);
        await this.quiesceEnvironmentAffectedRuntimes(providersToQuiesce);
      }
      await this.mutateSettings((settings) => {
        const settingsBag = settings as unknown as Record<string, unknown>;
        const changedScopes: EnvironmentScope[] = [];
        for (const [scope, envText] of nextEnvironmentByScope) {
          const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
          if (currentValue !== envText) {
            changedScopes.push(scope);
          }
          setEnvironmentVariablesForScope(settingsBag, scope, envText);
        }
        affectedProviderIds = this.getAffectedEnvironmentProviders(changedScopes);
        ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affectedProviderIds);
        const reconciliation = this.reconcileModelWithEnvironment(
          affectedProviderIds,
          false,
        );
        sessionInvalidationProviderIds = reconciliation.sessionInvalidationProviderIds;
        invalidationGenerations = this.stagePendingSessionInvalidations(
          settings,
          sessionInvalidationProviderIds,
        );
      }, () => {
        this.commitPendingSessionInvalidations(invalidationGenerations);
        this.blockEnvironmentInvalidationCompletion(invalidationGenerations);
        ProviderSettingsCoordinator.invalidateConversationSessions(
          this.conversationRepository.getAll(),
          sessionInvalidationProviderIds,
        );
        invalidationPublished = true;
      });
      settingsCommitted = true;
    } catch (error) {
      if (error instanceof SettingsPostCommitError) {
        settingsCommitted = true;
        errors.push(error.cause);
      } else {
        errors.push(error);
      }
    }

    const modelCatalogDiagnostics: string[] = [];
    if (settingsCommitted && affectedProviderIds.length > 0) {
      try {
        for (const providerId of affectedProviderIds) {
          if (ProviderRegistry.isEnabled(providerId, this.settings)) {
            const transitionOwner = { providerTransitionOwner: true } as const;
            const result = await ProviderWorkspaceRegistry.refreshModelCatalog(
              providerId,
              transitionOwner,
            );
            if (result.diagnostics) {
              modelCatalogDiagnostics.push(
                `${ProviderRegistry.getProviderDisplayName(providerId)}: ${result.diagnostics}`,
              );
            }
            await ProviderWorkspaceRegistry.refreshAgentMentions(
              providerId,
              transitionOwner,
            );
          }
        }
      } catch (error) {
        errors.push(error);
      }

      if (invalidationPublished && invalidationGenerations.size > 0) {
        let invalidationMetadataPersisted = false;
        try {
          const invalidatedProviderIds = new Set(invalidationGenerations.keys());
          const conversationsToPersist = this.conversationRepository.getAll().filter(
            conversation => invalidatedProviderIds.has(conversation.providerId),
          );
          for (const conv of conversationsToPersist) {
            if (this.conversationRepository.getCachedConversation(conv.id) !== conv) {
              continue;
            }
            await this.storage.sessions.saveMetadata(
              this.storage.sessions.toSessionMetadata(conv)
            );
          }
          invalidationMetadataPersisted = true;
        } catch (error) {
          errors.push(error);
        }
        if (invalidationMetadataPersisted) {
          this.releaseEnvironmentInvalidationCompletion(invalidationGenerations);
          if (this.hasLoadedAllSessionMetadata && !this.isUnloading) {
            try {
              await this.completePendingSessionInvalidations(invalidationGenerations);
            } catch (error) {
              errors.push(error);
            }
          }
        }
      }

      try {
        const openViews = this.getAllViews();
        let failedTabs = 0;
        for (const openView of openViews) {
          failedTabs += await this.restartEnvironmentAffectedRuntimes(
            openView,
            affectedProviderIds,
            sessionInvalidationProviderIds,
          );
          openView.invalidateProviderCommandCaches(affectedProviderIds);
          openView.refreshModelSelector();
        }
        if (failedTabs > 0) {
          new Notice(`Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`);
        }
      } catch (error) {
        errors.push(error);
      }

      const noticeText = sessionInvalidationProviderIds.length > 0
        ? 'Environment variables applied. Sessions will be rebuilt on next message.'
        : 'Environment variables applied.';
      new Notice(noticeText);
      if (modelCatalogDiagnostics.length > 0) {
        new Notice(`Model catalog refresh failed:\n${modelCatalogDiagnostics.join('\n')}`);
      }
    }

    try {
      await auxiliaryTransition?.release();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Environment change recovery failed.');
    }
  }

  private async restartEnvironmentAffectedRuntimes(
    view: CodianView,
    affectedProviderIds: ProviderId[],
    sessionInvalidationProviderIds: ProviderId[],
  ): Promise<number> {
    const tabManager = view.getTabManager();
    if (!tabManager) return 0;

    const affectedTabs = tabManager.getAllTabs().filter((tab) => (
      affectedProviderIds.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID)
    ));
    const syncTabRuntimeState = (tab: (typeof affectedTabs)[number]): void => {
      if (!tab.service || !tab.serviceInitialized) return;

      const conversation = tab.conversationId
        ? this.getConversationSync(tab.conversationId)
        : null;
      const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
      const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
        ?? (hasConversationContext
          ? conversation?.externalContextPaths ?? []
          : this.settings.persistentExternalContextPaths ?? []);

      tab.service.syncConversationState(conversation, externalContextPaths);
    };

    let failedTabs = 0;
    for (const tab of affectedTabs) {
      if (!tab.service || !tab.serviceInitialized) continue;
      try {
        syncTabRuntimeState(tab);
        const providerId = tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
        if (sessionInvalidationProviderIds.includes(providerId)) {
          tab.service.resetSession();
          await tab.service.ensureReady({ providerTransitionOwner: true });
        } else {
          await tab.service.ensureReady({
            allowSessionCreation: false,
            force: true,
            providerTransitionOwner: true,
          });
        }
      } catch {
        failedTabs++;
      }
    }
    return failedTabs;
  }

  private async quiesceEnvironmentAffectedRuntimes(
    affectedProviderIds: ProviderId[],
  ): Promise<void> {
    const activeTurnFinalizations: Promise<void>[] = [];
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;
      for (const tab of tabManager.getAllTabs()) {
        const providerId = tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
        if (!affectedProviderIds.includes(providerId)) continue;
        const inputController = tab.controllers?.inputController;
        if (inputController) {
          activeTurnFinalizations.push(inputController.cancelStreamingAndWait());
        }
      }
    }
    await Promise.all(activeTurnFinalizations);
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  async getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): Promise<string | null> {
    // Provider launches resolve their CLI here first, so the login-shell PATH is ready for them.
    await resolveLoginShellPath();
    if (context?.providerTransitionOwner !== true) {
      await ProviderWorkspaceRegistry.ensureInitialized(
        this.providerHost,
        providerId,
        'cli-resolution',
      );
    }
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      if (context?.providerTransitionOwner === true) {
        throw new Error(
          `Provider transition owner requires initialized workspace services for "${providerId}".`,
        );
      }
      return null;
    }

    return await cliResolver.resolveFromSettings(this.settings, context);
  }

  private reconcileModelWithEnvironment(
    providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds(),
    invalidateConversations = true,
  ): SettingsReconciliationResult {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversationRepository.getAll(),
      providerIds,
      { invalidateConversations },
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
  }): Promise<Conversation> {
    return this.conversationRepository.create(options);
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    return this.conversationRepository.switchTo(id);
  }

  async deleteConversation(
    id: string,
    options: { deleteProviderSession?: boolean } = {},
  ): Promise<void> {
    await this.conversationRepository.delete(id, options);
  }

  private async resetDeletedConversationTabs(id: string): Promise<void> {
    this.sessionRuntimePool.retireConversation(id);
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;
      tabManager.resetDeletedConversation?.(id);
    }
  }

  async handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'> {
    return this.conversationRepository.handleMissingProviderSession(id, missingProviderSessionId);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.conversationRepository.rename(id, title);
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    await this.conversationRepository.update(id, updates);
  }

  setConversationAttention(id: string, attention: TabAttention): void {
    for (const view of this.getAllViews()) {
      for (const tab of view.getTabManager()?.getAllTabs() ?? []) {
        if (tab.conversationId !== id) continue;
        if (attention?.kind === 'review') {
          tab.state.markReviewRequired(attention.outcome, attention.since);
        } else if (attention === null) {
          tab.state.acknowledgeReview();
        }
      }
    }
    this.sessionRuntimePool.setConversationAttention(id, attention);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    return this.conversationRepository.getById(id);
  }

  getCachedConversation(id: string): Conversation | null {
    return this.conversationRepository.getCachedConversation(id);
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversationRepository.getSync(id);
  }

  findEmptyConversation(): Conversation | null {
    return this.conversationRepository.findEmpty();
  }

  getConversationList(): ConversationMeta[] {
    return this.conversationRepository.list();
  }

  getConversationBrowserEnhancement(): ConversationBrowserEnhancement {
    return this.conversationBrowserEnhancement;
  }

  getComposerEnhancement(): ComposerEnhancement {
    return this.composerEnhancement;
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    if (!isValidTabManagerState(state)) {
      throw new TypeError('Invalid tab manager state');
    }
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): CodianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODIAN);
    return leaves.map(leaf => leaf.view).find(isCodianView) ?? null;
  }

  getAllViews(): CodianView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODIAN);
    return leaves.map(leaf => leaf.view).filter(isCodianView);
  }

  findConversationAcrossViews(conversationId: string): { view: CodianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.settings?.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }

}
