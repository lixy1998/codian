import { Notice } from 'obsidian';
import * as path from 'path';

import type { DocumentAttachment, ImageAttachment, ImageMediaType } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import {
  createDocumentAttachment,
  formatAttachmentSize,
  MAX_TOTAL_DOCUMENT_TEXT_CHARS,
  UnsupportedDocumentError,
} from '../../../utils/documentAttachment';
import { ComposerContextTray } from './ComposerContextTray';

/** Provider-side ceiling for a single inline image; larger files are resized instead of refused. */
const MAX_IMAGE_SIZE = 4.5 * 1024 * 1024;

/** Longest edge tried first when an image must be resized. */
const IMAGE_RESIZE_STEPS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: 2048, quality: 0.9 },
  { maxEdge: 1600, quality: 0.82 },
  { maxEdge: 1200, quality: 0.75 },
  { maxEdge: 900, quality: 0.7 },
];

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged?: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private contextTray: ComposerContextTray;
  private ownedContextTray: ComposerContextTray | null = null;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  private attachedDocuments: Map<string, DocumentAttachment> = new Map();
  private attachmentGeneration = 0;
  private enabled = true;
  private destroyed = false;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    contextTray?: ComposerContextTray,
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    if (contextTray) {
      this.contextTray = contextTray;
    } else {
      const ownedTrayContainer = (previewContainerEl ?? containerEl).createDiv({ cls: 'codian-context-row' });
      this.contextTray = new ComposerContextTray(ownedTrayContainer);
      this.ownedContextTray = this.contextTray;
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.attachmentGeneration += 1;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  getAttachedDocuments(): DocumentAttachment[] {
    return Array.from(this.attachedDocuments.values());
  }

  hasDocuments(): boolean {
    return this.attachedDocuments.size > 0;
  }

  /** True when the composer holds any attachment that can start a turn on its own. */
  hasAttachments(): boolean {
    return this.attachedImages.size > 0 || this.attachedDocuments.size > 0;
  }

  clearImages() {
    this.attachmentGeneration += 1;
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  clearDocuments() {
    if (this.attachedDocuments.size === 0) return;
    this.attachmentGeneration += 1;
    this.attachedDocuments.clear();
    this.updateDocumentPreview();
    this.callbacks.onImagesChanged?.();
  }

  /** Sets documents directly (used for queued messages). */
  setDocuments(documents: DocumentAttachment[]) {
    if (this.destroyed) return;
    this.attachmentGeneration += 1;
    this.attachedDocuments.clear();
    for (const document of documents) {
      this.attachedDocuments.set(document.id, document);
    }
    this.updateDocumentPreview();
    this.callbacks.onImagesChanged?.();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    if (this.destroyed) return;
    this.attachmentGeneration += 1;
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.attachmentGeneration += 1;
    this.attachedImages.clear();
    this.attachedDocuments.clear();
    this.contextTray.clearItems('images');
    this.contextTray.clearItems('files');
    this.ownedContextTray?.destroy();
    this.ownedContextTray = null;
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.codian-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = inputWrapper.createDiv({ cls: 'codian-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'codian-drop-content' });
    const svg = dropContent.createSvg('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const pathEl = svg.createSvg('path');
    pathEl.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = svg.createSvg('polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = svg.createSvg('line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '3');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');
    svg.appendChild(pathEl);
    svg.appendChild(polyline);
    svg.appendChild(line);
    dropContent.appendChild(svg);
    dropContent.createSpan({ text: t('chat.composer.dropFile') });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    dropZone.addEventListener('drop', (e) => {
      void this.handleDrop(e);
    });
  }

  private handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.addClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.codian-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;
    const generation = this.attachmentGeneration;

    for (let i = 0; i < files.length; i++) {
      if (generation !== this.attachmentGeneration || this.destroyed) return;
      const file = files[i];
      if (this.isImageFile(file)) {
        // Images need a provider that accepts them; documents travel as prompt text.
        if (!this.enabled) continue;
        await this.addImageFromFile(file, 'drop');
      } else {
        await this.addDocumentFromFile(file);
      }
      if (generation !== this.attachmentGeneration || this.destroyed) return;
    }
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const generation = this.attachmentGeneration;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, 'paste');
          }
          if (generation !== this.attachmentGeneration || this.destroyed || !this.enabled) return;
          return;
        }
      }
      })();
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (this.destroyed) return false;
    if (!this.enabled) {
      new Notice(t('chat.images.unsupportedProvider'));
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError(t('chat.images.unsupportedType'));
      return false;
    }

    const generation = this.attachmentGeneration;
    try {
      const prepared = await this.prepareImagePayload(file, mediaType);
      if (generation !== this.attachmentGeneration || this.destroyed || !this.enabled) {
        return false;
      }
      if (!prepared) {
        this.notifyImageError(t('chat.images.attachFailed'));
        return false;
      }

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType: prepared.mediaType,
        data: prepared.base64,
        size: prepared.size,
        width: prepared.width,
        height: prepared.height,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged?.();
      return true;
    } catch (error) {
      if (generation !== this.attachmentGeneration || this.destroyed || !this.enabled) {
        return false;
      }
      this.notifyImageError(t('chat.images.attachFailed'), error);
      return false;
    }
  }

  /**
   * Returns an inline payload for the image, resizing anything above the
   * provider ceiling instead of refusing it.
   */
  private async prepareImagePayload(
    file: File,
    mediaType: ImageMediaType,
  ): Promise<{
    base64: string
    mediaType: ImageMediaType
    size: number
    width?: number
    height?: number
  } | null> {
    if (file.size <= MAX_IMAGE_SIZE) {
      return { base64: await this.fileToBase64(file), mediaType, size: file.size };
    }
    return this.resizeImage(file);
  }

  private async resizeImage(file: File): Promise<{
    base64: string
    mediaType: ImageMediaType
    size: number
    width: number
    height: number
  } | null> {
    const ownerWindow = this.containerEl.ownerDocument?.defaultView ?? window;
    const objectUrl = URL.createObjectURL(file);
    let smallest: {
      base64: string
      mediaType: ImageMediaType
      size: number
      width: number
      height: number
    } | null = null;

    try {
      const image = await this.loadImageElement(objectUrl, ownerWindow);
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) return null;

      for (const step of IMAGE_RESIZE_STEPS) {
        const scale = Math.min(1, step.maxEdge / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = ownerWindow.document.createEl('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) continue;

        // Flatten transparency onto white so JPEG output keeps sane colors.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', step.quality);
        });
        if (!blob) continue;

        const candidate = {
          base64: await this.blobToBase64(blob),
          mediaType: 'image/jpeg' as ImageMediaType,
          size: blob.size,
          width: targetWidth,
          height: targetHeight,
        };
        if (blob.size <= MAX_IMAGE_SIZE) return candidate;
        if (!smallest || blob.size < smallest.size) smallest = candidate;
      }
      return smallest;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private loadImageElement(url: string, ownerWindow: Window): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = ownerWindow.document.createEl('img');
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image-decode-failed'));
      image.src = url;
    });
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }

  private async addDocumentFromFile(file: File): Promise<boolean> {
    if (this.destroyed) return false;
    // Folders arrive as zero-byte entries and carry nothing to attach.
    if (file.size === 0) {
      this.notifyImageError(t('chat.documents.attachFailed', { name: file.name }));
      return false;
    }
    const generation = this.attachmentGeneration;

    const remainingChars = this.remainingDocumentChars();
    if (remainingChars <= 0) {
      this.notifyImageError(t('chat.documents.budgetExhausted'));
      return false;
    }

    try {
      const document = await createDocumentAttachment(file, 'drop', { remainingChars });
      if (generation !== this.attachmentGeneration || this.destroyed) return false;

      this.attachedDocuments.set(document.id, document);
      this.updateDocumentPreview();
      this.callbacks.onImagesChanged?.();
      return true;
    } catch (error) {
      if (generation !== this.attachmentGeneration || this.destroyed) return false;
      if (error instanceof UnsupportedDocumentError) {
        this.notifyImageError(t('chat.documents.pathUnavailable', { name: file.name }));
        return false;
      }
      this.notifyImageError(t('chat.documents.attachFailed', { name: file.name }), error);
      return false;
    }
  }

  private remainingDocumentChars(): number {
    let used = 0;
    for (const document of this.attachedDocuments.values()) {
      used += document.text?.length ?? 0;
    }
    return Math.max(0, MAX_TOTAL_DOCUMENT_TEXT_CHARS - used);
  }

  private async fileToBase64(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    if (this.attachedImages.size === 0) {
      this.contextTray.clearItems('images');
      return;
    }

    const images = Array.from(this.attachedImages);
    this.contextTray.setItems('images', images.map(([id, image], index) => ({
      id,
      kind: 'image' as const,
      label: images.length === 1 ? t('chat.images.label') : t('chat.images.numbered', { number: index + 1 }),
      title: `${image.name} · ${this.formatSize(image.size)}`,
      ariaLabel: t('chat.images.attachment', { name: image.name, size: this.formatSize(image.size) }),
      onActivate: () => this.showFullImage(image),
      onRemove: () => {
        this.attachedImages.delete(id);
        this.updateImagePreview();
        this.callbacks.onImagesChanged?.();
      },
    })));
  }

  private updateDocumentPreview() {
    if (this.attachedDocuments.size === 0) {
      this.contextTray.clearItems('files');
      return;
    }

    this.contextTray.setItems('files', Array.from(this.attachedDocuments).map(([id, document]) => {
      const sizeLabel = formatAttachmentSize(document.size);
      return {
        id,
        kind: 'file' as const,
        label: document.name,
        icon: 'file-text',
        title: document.truncated
          ? `${document.name} · ${sizeLabel} · ${t('chat.documents.truncated')}`
          : `${document.name} · ${sizeLabel}`,
        ariaLabel: t('chat.documents.attachment', { name: document.name, size: sizeLabel }),
        onRemove: () => {
          this.attachedDocuments.delete(id);
          this.updateDocumentPreview();
          this.callbacks.onImagesChanged?.();
        },
      };
    }));
  }

  private showFullImage(image: ImageAttachment) {
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'codian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'codian-image-modal' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('chat.images.preview', { name: image.name }));

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'codian-image-modal-close' });
    closeBtn.setAttribute('aria-label', t('chat.images.closePreview'));
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = t('chat.images.fileNotFound', { message });
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = t('chat.images.permissionDenied', { message });
      }
    }
    new Notice(userMessage);
  }
}
