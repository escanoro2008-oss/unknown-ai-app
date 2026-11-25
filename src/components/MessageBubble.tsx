import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import type { GeneratedImage, Message } from '../types/chat';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasLargeCodeContent(text: string): boolean {
  const codeBlockRegex = /```[^\n]*\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let blockCount = 0;
  let totalCodeChars = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    blockCount += 1;
    const content = match[1] ?? '';
    totalCodeChars += content.length;
    const lines = content.split(/\r?\n/);
    if (lines.length >= 12) return true;
    if (lines.some((line) => line.length >= 68)) return true;
  }

  if (totalCodeChars >= 320) return true;
  if (blockCount >= 2 && text.length >= 450) return true;
  return false;
}

let activeSpeechId: string | null = null;
const speechSubscribers = new Set<(id: string | null) => void>();

function notifySpeechState(id: string | null) {
  activeSpeechId = id;
  for (const listener of speechSubscribers) {
    listener(id);
  }
}

function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\|/g, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSpeechLang(text: string): 'ar-SA' | 'en-US' {
  const arabicMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? [];
  const latinMatches = text.match(/[A-Za-z]/g) ?? [];
  return arabicMatches.length >= latinMatches.length && arabicMatches.length > 0
    ? 'ar-SA'
    : 'en-US';
}

function pickVoice(lang: 'ar-SA' | 'en-US'): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const prefix = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ||
    null
  );
}

function CodeBlock({
  className,
  children,
  forceExpanded = false,
}: {
  className?: string;
  children?: ReactNode;
  forceExpanded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(false);
  const match = /language-([\w-]+)/.exec(className || '');
  const language = match ? match[1] : 'code';
  const codeText = String(children ?? '').replace(/\n$/, '');
  const lines = useMemo(() => codeText.split('\n'), [codeText]);
  const isTall = lines.length > 16;
  const isCodeExpanded = forceExpanded || localExpanded;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  return (
    <div
      dir="ltr"
      className="my-3.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100 dark:border-slate-800"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3.5 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="font-mono">{language}</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="font-mono tabular-nums text-slate-500">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isTall && !forceExpanded && (
            <button
              type="button"
              onClick={() => setLocalExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {localExpanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>طي الكود</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span>توسيع الكود</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-800 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>تم النسخ</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>نسخ</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="relative">
        <pre
          className={`overflow-x-auto p-4 text-[13px] leading-relaxed ${
            isTall && !isCodeExpanded ? 'max-h-[340px] overflow-y-hidden' : ''
          }`}
        >
          <code className="font-mono text-slate-100">
            {lines.length >= 5 ? (
              <span className="table w-full">
                {lines.map((line, i) => (
                  <span key={i} className="table-row">
                    <span className="table-cell select-none pe-4 text-end font-mono text-xs tabular-nums text-slate-600">
                      {i + 1}
                    </span>
                    <span className="table-cell whitespace-pre">
                      {line.length > 0 ? line : ' '}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              codeText
            )}
          </code>
        </pre>

        {isTall && !isCodeExpanded && (
          <div className="flex items-end justify-center bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent pt-10 pb-3 absolute inset-x-0 bottom-0">
            <button
              type="button"
              onClick={() => setLocalExpanded(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 shadow-xs transition-colors hover:border-slate-600 hover:bg-slate-800"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>عرض الكود كاملاً ({lines.length})</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  isStreaming = false,
  isLastAssistant = false,
  onRegenerate,
  isExpanded = false,
  onToggleExpand,
}: MessageBubbleProps) {
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<GeneratedImage | null>(null);
  const isMountedRef = useRef(true);

  const isExpandable = useMemo(
    () => !isStreaming && hasLargeCodeContent(message.text),
    [isStreaming, message.text]
  );

  const supportsSpeech =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    isMountedRef.current = true;
    const handleSpeechChange = (currentId: string | null) => {
      if (isMountedRef.current) {
        setIsSpeaking(currentId === message.id);
      }
    };
    speechSubscribers.add(handleSpeechChange);

    return () => {
      isMountedRef.current = false;
      speechSubscribers.delete(handleSpeechChange);
      if (activeSpeechId === message.id && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        notifySpeechState(null);
      }
    };
  }, [message.id]);

  const handleToggleSpeech = () => {
    if (!supportsSpeech) return;
    setTtsError(null);

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      notifySpeechState(null);
      return;
    }

    const spokenText = stripMarkdownForSpeech(message.text);
    if (!spokenText) return;

    window.speechSynthesis.cancel();

    const lang = detectSpeechLang(spokenText);
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;

    const voice = pickVoice(lang);
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onstart = () => {
      notifySpeechState(message.id);
    };

    utterance.onend = () => {
      if (activeSpeechId === message.id) {
        notifySpeechState(null);
      }
    };

    utterance.onerror = (event) => {
      if (activeSpeechId === message.id) {
        notifySpeechState(null);
      }
      if (event.error !== 'interrupted' && event.error !== 'canceled' && isMountedRef.current) {
        setTtsError('تعذّر تشغيل الصوت في هذا المتصفح.');
      }
    };

    notifySpeechState(message.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  if (message.role === 'user') {
    return (
      <div className="flex justify-end py-3">
        <div
          className={`group flex flex-col items-end gap-2 ${
            isExpanded ? 'w-full max-w-full' : 'max-w-[85%] sm:max-w-[76%]'
          }`}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((att) =>
                att.previewUrl ? (
                  <img
                    key={att.id}
                    src={att.previewUrl}
                    alt={att.name}
                    referrerPolicy="no-referrer"
                    className="max-h-48 max-w-[240px] rounded-xl border border-slate-200 object-cover dark:border-slate-800"
                  />
                ) : (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <FileText className="h-3.5 w-3.5 text-slate-400" />
                    <span className="max-w-[180px] truncate">{att.name}</span>
                  </div>
                )
              )}
            </div>
          )}

          {message.text.trim().length > 0 && (
            <div
              dir="auto"
              className={`rounded-2xl rtl:rounded-tl-sm ltr:rounded-tr-sm border border-slate-200/90 bg-slate-100 px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap text-slate-900 dark:border-slate-800 dark:bg-[#1B1F27] dark:text-slate-100 ${
                isExpanded ? 'w-full overflow-x-auto font-mono text-[13.5px]' : ''
              }`}
            >
              {message.text}
            </div>
          )}

          <div
            className={`flex items-center gap-2 transition-opacity ${
              isExpandable || isExpanded
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            <span className="font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
              {formatTime(message.createdAt)}
            </span>
            {isExpandable && onToggleExpand && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-pressed={isExpanded}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isExpanded
                    ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60'
                    : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {isExpanded ? (
                  <>
                    <Minimize2 className="h-3 w-3" />
                    <span>تصغير العرض</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3 w-3" />
                    <span>التوسيع الكامل</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyMessage}
              aria-label="نسخ الرسالة"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {copiedMessage ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group py-4">
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 shrink-0">
          <BrandMark size={26} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                dir="ltr"
                className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Unknown AI
              </span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500">
                {formatTime(message.createdAt)}
              </span>
            </div>

            {isExpandable && onToggleExpand && (
              <button
                type="button"
                onClick={onToggleExpand}
                aria-pressed={isExpanded}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isExpanded
                    ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/70 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {isExpanded ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span>تصغير العرض</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>التوسيع الكامل</span>
                  </>
                )}
              </button>
            )}
          </div>

          {message.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message.error || message.text}</span>
              </div>
              {isLastAssistant && onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-800/70 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/50"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>إعادة المحاولة</span>
                </button>
              )}
            </div>
          ) : (
            <div dir="auto" className="unknown-prose text-slate-800 dark:text-slate-200">
              {message.generatedImages && message.generatedImages.length > 0 && (
                <div className="mb-3 flex flex-col gap-3">
                  {message.generatedImages.map((img, idx) => {
                    const ext = img.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
                    const filename = `unknown-ai-${img.mode}-${idx + 1}.${ext}`;
                    return (
                      <div
                        key={`${idx}-${img.dataUrl.slice(0, 32)}`}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#13161C]"
                      >
                        <button
                          type="button"
                          onClick={() => setZoomedImage(img)}
                          aria-label="تكبير الصورة"
                          className="block w-full cursor-zoom-in bg-slate-100/60 dark:bg-slate-900/60"
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.prompt || 'صورة مولّدة بواسطة Unknown AI'}
                            className="mx-auto max-h-[440px] w-full object-contain"
                          />
                        </button>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-3 py-2 text-xs dark:border-slate-800/80">
                          <span className="text-slate-500 dark:text-slate-400">
                            {img.mode === 'enhanced' ? 'صورة محسّنة' : 'صورة مولّدة بالذكاء الاصطناعي'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setZoomedImage(img)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                              <span>تكبير</span>
                            </button>
                            <a
                              href={img.dataUrl}
                              download={filename}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white no-underline transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>تنزيل</span>
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {message.text ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre({ children }) {
                      return <>{children}</>;
                    },
                    code({ className, children, ...props }) {
                      const isBlock = Boolean(className) || String(children).includes('\n');
                      if (isBlock) {
                        return (
                          <CodeBlock className={className} forceExpanded={isExpanded}>
                            {children}
                          </CodeBlock>
                        );
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    a({ href, children }) {
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {message.text}
                </ReactMarkdown>
              ) : isStreaming && !(message.generatedImages && message.generatedImages.length > 0) ? (
                <div className="flex items-center gap-2.5 py-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  <span>جارٍ المعالجة...</span>
                </div>
              ) : null}

              {isStreaming && message.text && (
                <span
                  aria-hidden="true"
                  className="ms-1 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-xs bg-blue-600 dark:bg-blue-400"
                />
              )}

              {message.error && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{message.error}</span>
                </div>
              )}
            </div>
          )}

          {message.sources && message.sources.length > 0 && (
            <div className="mt-4 border-t border-slate-200/80 pt-3 dark:border-slate-800/80">
              <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                المصادر
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {message.sources.map((src, idx) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-slate-600 underline decoration-slate-300 underline-offset-3 transition-colors hover:text-blue-600 hover:decoration-blue-500 dark:text-slate-400 dark:decoration-slate-700 dark:hover:text-blue-400"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-slate-400">
                      [{idx + 1}]
                    </span>
                    <span className="max-w-[240px] truncate">{src.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {!isStreaming && (message.text || (message.generatedImages && message.generatedImages.length > 0)) && !message.isError && (
            <div
              className={`mt-2.5 flex flex-wrap items-center gap-1.5 transition-opacity ${
                isSpeaking || isExpanded || isExpandable
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              }`}
            >
              {message.text && (
                <button
                  type="button"
                  onClick={handleCopyMessage}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  {copiedMessage ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>نسخ</span>
                    </>
                  )}
                </button>
              )}

              {supportsSpeech && message.text && (
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  aria-pressed={isSpeaking}
                  aria-label={isSpeaking ? 'إيقاف القراءة الصوتية' : 'الاستماع إلى الإجابة'}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isSpeaking
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60'
                      : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {isSpeaking ? (
                    <>
                      <Square className="h-3 w-3 fill-current" />
                      <span>إيقاف</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3.5 w-3.5" />
                      <span>استماع</span>
                    </>
                  )}
                </button>
              )}

              {isExpandable && onToggleExpand && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  aria-pressed={isExpanded}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isExpanded
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60'
                      : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {isExpanded ? (
                    <>
                      <Minimize2 className="h-3.5 w-3.5" />
                      <span>تصغير العرض</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>التوسيع الكامل</span>
                    </>
                  )}
                </button>
              )}

              {isLastAssistant && onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 whitespace-nowrap shrink-0 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>إعادة التوليد</span>
                </button>
              )}

              {ttsError && (
                <span className="ms-1 text-xs text-red-600 dark:text-red-400">
                  {ttsError}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {zoomedImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الصورة"
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              aria-label="إغلاق المعاينة"
              className="absolute top-3 end-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/75 text-white hover:bg-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={zoomedImage.dataUrl}
              alt={zoomedImage.prompt || 'معاينة الصورة'}
              className="max-h-[84vh] w-auto max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
