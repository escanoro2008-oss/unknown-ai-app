import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import {
  ArrowUp,
  FileText,
  Globe,
  ImagePlus,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import type { Attachment, ThinkingMode } from '../types/chat';

interface ComposerProps {
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  isGenerating: boolean;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  thinkingMode: ThinkingMode;
  onChangeThinkingMode: (mode: ThinkingMode) => void;
  draftText?: string;
  onDraftConsumed?: () => void;
}

const MAX_RAW_FILE_SIZE = 15 * 1024 * 1024;
const MAX_NON_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'html',
  'css',
  'sql',
  'yaml',
  'yml',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'bmp',
]);

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageAttachment(file: File): Promise<Attachment> {
  const dataUrl = await readAsDataUrl(file);
  const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const fallbackMime = file.type || 'image/jpeg';

  // Keep small WebP/PNG/GIF/JPEG images untouched if already compact
  if (file.size <= 1.2 * 1024 * 1024 && file.type && file.type !== 'image/heic' && file.type !== 'image/heif') {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: fallbackMime,
      size: file.size,
      data: rawBase64,
      previewUrl: dataUrl,
      isText: false,
    };
  }

  // Resize & compress large phone photos so mobile uploads are fast and reliable
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = dataUrl;
    });

    const { naturalWidth, naturalHeight } = img;
    if (!naturalWidth || !naturalHeight) {
      throw new Error('Invalid image dimensions');
    }

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(naturalWidth, naturalHeight));
    const targetW = Math.max(1, Math.round(naturalWidth * scale));
    const targetH = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const outMime = file.type === 'image/png' && file.size < 2 * 1024 * 1024 ? 'image/png' : 'image/jpeg';
    const compressedDataUrl = canvas.toDataURL(outMime, 0.86);
    const compressedBase64 = compressedDataUrl.split(',')[1] ?? rawBase64;
    const approxBytes = Math.round((compressedBase64.length * 3) / 4);

    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: outMime,
      size: approxBytes,
      data: compressedBase64,
      previewUrl: compressedDataUrl,
      isText: false,
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: fallbackMime,
      size: file.size,
      data: rawBase64,
      previewUrl: dataUrl,
      isText: false,
    };
  }
}

async function readFileAsAttachment(file: File): Promise<Attachment> {
  if (isImageFile(file)) {
    return optimizeImageAttachment(file);
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext);

  if (isText) {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(file);
    });
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || 'text/plain',
      size: file.size,
      data: text,
      isText: true,
    };
  }

  const dataUrl = await readAsDataUrl(file);
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    data: base64,
    isText: false,
  };
}

export function Composer({
  onSend,
  onStop,
  isGenerating,
  webSearch,
  onToggleWebSearch,
  thinkingMode,
  onChangeThinkingMode,
  draftText,
  onDraftConsumed,
}: ComposerProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draftText) {
      setInput(draftText);
      onDraftConsumed?.();
      textareaRef.current?.focus();
    }
  }, [draftText, onDraftConsumed]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setFileError(null);
    const availableSlots = 4 - attachments.length;
    if (availableSlots <= 0) {
      setFileError('يمكنك إرفاق 4 عناصر كحد أقصى في الرسالة الواحدة.');
      return;
    }

    setIsProcessingFiles(true);
    const nextAttachments: Attachment[] = [];

    try {
      for (const file of files.slice(0, availableSlots)) {
        const isImg = isImageFile(file);
        const limit = isImg ? MAX_RAW_FILE_SIZE : MAX_NON_IMAGE_SIZE;
        if (file.size > limit) {
          setFileError(
            `يتجاوز ${file.name} الحد الأقصى المسموح به (${isImg ? '15' : '5'} ميجابايت).`
          );
          continue;
        }
        try {
          const parsed = await readFileAsAttachment(file);
          nextAttachments.push(parsed);
        } catch {
          setFileError(`تعذّرت قراءة الملف ${file.name}.`);
        }
      }

      if (nextAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...nextAttachments]);
        textareaRef.current?.focus();
      }
    } finally {
      setIsProcessingFiles(false);
    }
  };

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await processFiles(files);
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const pastedImages = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (pastedImages.length > 0) {
      e.preventDefault();
      await processFiles(pastedImages);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    await processFiles(dropped);
  };

  const handleSubmit = () => {
    if (isGenerating || isProcessingFiles) return;
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments);
    setInput('');
    setAttachments([]);
    setFileError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasImageAttachment = attachments.some((a) => Boolean(a.previewUrl));
  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !isGenerating &&
    !isProcessingFiles;

  return (
    <div className="shrink-0 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/95 to-transparent px-4 pt-2 pb-4 dark:from-[#0B0D11] dark:via-[#0B0D11]/95 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {fileError && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <span>{fileError}</span>
            <button
              type="button"
              onClick={() => setFileError(null)}
              aria-label="إغلاق التنبيه"
              className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-2xl border bg-white p-3 shadow-xs transition-colors dark:bg-[#13161C] ${
            isDragging
              ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400'
              : 'border-slate-200 focus-within:border-slate-300 dark:border-slate-800 dark:focus-within:border-slate-700'
          }`}
        >
          {attachments.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2 px-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 pr-7 dark:border-slate-800 dark:bg-slate-900"
                >
                  {att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      referrerPolicy="no-referrer"
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <FileText className="h-4 w-4" />
                    </div>
                  )}
                  <div className="max-w-[140px]">
                    <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                      {att.name}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-slate-400" dir="ltr">
                      {(att.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                    aria-label={`إزالة ${att.name}`}
                    className="absolute top-1.5 end-1.5 rounded-md p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isProcessingFiles}
              aria-label="رفع صورة"
              title="رفع صورة من الجهاز"
              className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200/90 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ImagePlus className="h-4 w-4" />
            </button>

            <textarea
              ref={textareaRef}
              dir="auto"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                hasImageAttachment
                  ? 'اسأل سؤالاً حول هذه الصورة أو اطلب تعديلها أو تحسينها...'
                  : 'اسأل Unknown AI عن أي شيء، أو اطلب تحسين نص أو إنشاء صورة...'
              }
              aria-label="اكتب رسالتك إلى Unknown AI"
              className="max-h-[200px] min-h-[40px] w-full resize-none bg-transparent px-1 py-1.5 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.sql,image/*"
                onChange={handleFilesSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessingFiles}
                aria-label="إرفاق ملفات"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">إرفاق ملف</span>
              </button>

              <button
                type="button"
                onClick={onToggleWebSearch}
                aria-pressed={webSearch}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  webSearch
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span>بحث الويب</span>
              </button>

              <select
                aria-label="مستوى التفكير"
                value={thinkingMode}
                onChange={(e) => onChangeThinkingMode(e.target.value as ThinkingMode)}
                className="h-8 rounded-lg border border-slate-200 bg-transparent px-2 text-xs font-medium text-slate-600 focus:border-blue-500 focus:outline-none sm:hidden dark:border-slate-800 dark:text-slate-300"
              >
                <option value="fast">سريع</option>
                <option value="balanced">متوازن</option>
                <option value="deep">عميق</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              {isGenerating ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="إيقاف التوليد"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>إيقاف</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSend}
                  aria-label="إرسال الرسالة"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    canSend
                      ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
                      : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
                  }`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
          قد يرتكب Unknown AI بعض الأخطاء. يرجى التحقق من المعلومات المهمة.
        </p>
      </div>
    </div>
  );
}
