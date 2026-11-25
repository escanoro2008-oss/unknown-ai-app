import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { MessageBubble } from './components/MessageBubble';
import { Sidebar } from './components/Sidebar';
import { WelcomeScreen } from './components/WelcomeScreen';
import type {
  Attachment,
  Conversation,
  GeneratedImage,
  GroundingSource,
  Message,
  ThinkingMode,
} from './types/chat';

const STORAGE_KEY = 'unknown_ai_conversations_v1';
const THEME_KEY = 'unknown_ai_theme';

function loadInitialConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadInitialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Fallback to light
  }
  return 'light';
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadInitialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(loadInitialTheme);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('balanced');
  const [webSearch, setWebSearch] = useState<boolean>(true);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState<boolean>(false);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canonicalUrl = `${window.location.origin}${window.location.pathname}`;
    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonicalUrl;

    let ogUrlMeta = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!ogUrlMeta) {
      ogUrlMeta = document.createElement('meta');
      ogUrlMeta.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrlMeta);
    }
    ogUrlMeta.content = canonicalUrl;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Strip heavy binary attachment payloads if localStorage quota is exceeded
      try {
        const compact = conversations.map((conv) => ({
          ...conv,
          messages: conv.messages.map((msg) => ({
            ...msg,
            generatedImages: undefined,
            attachments: msg.attachments?.map((att) => ({
              ...att,
              data: att.isText ? att.data.slice(0, 4000) : '',
              previewUrl: undefined,
            })),
          })),
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
      } catch {
        // Ignore if storage remains full
      }
    }
  }, [conversations]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomAnchorRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 140);
  }, []);

  useEffect(() => {
    if (streamingMessageId) {
      const el = scrollContainerRef.current;
      if (el) {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 200) {
          scrollToBottom('auto');
        }
      }
    }
  }, [activeConversation?.messages, streamingMessageId, scrollToBottom]);

  const handleNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingMessageId(null);
    setActiveId(null);
  }, []);

  const generateConversationTitle = useCallback(
    async (convId: string, prompt: string, reply: string) => {
      try {
        const res = await fetch('/api/chat/title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, reply }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { title?: string };
        if (data.title) {
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title: data.title! } : c))
          );
        }
      } catch {
        // Keep default fallback title
      }
    },
    []
  );

  const streamResponse = useCallback(
    async (
      convId: string,
      historyMessages: Message[],
      assistantMsgId: string,
      shouldAutoTitle: boolean,
      firstUserPrompt: string
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStreamingMessageId(assistantMsgId);

      let accumulatedText = '';
      let generatedImages: GeneratedImage[] = [];
      let sources: GroundingSource[] = [];

      try {
        const validHistory = historyMessages.filter((m) => !m.isError);
        let remainingBinaryAttachments = 2;
        const payloadMessagesReversed = [...validHistory].reverse().map((m) => {
          const attachments = m.attachments
            ?.filter((att) => Boolean(att.data))
            .filter((att) => {
              if (att.isText) return true;
              if (remainingBinaryAttachments > 0) {
                remainingBinaryAttachments -= 1;
                return true;
              }
              return false;
            })
            .map((att) => ({
              name: att.name,
              mimeType: att.mimeType,
              data: att.data,
              isText: att.isText,
            }));

          const fallbackImageNote =
            !m.text && m.generatedImages && m.generatedImages.length > 0
              ? `[تم إنشاء ${m.generatedImages.length} صورة]`
              : '';

          return {
            role: m.role,
            text: m.text || fallbackImageNote,
            attachments: attachments && attachments.length > 0 ? attachments : undefined,
          };
        });
        const payloadMessages = payloadMessagesReversed.reverse();

        const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: payloadMessages,
            thinkingMode,
            webSearch,
            timeZone: clientTimeZone,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          let errMsg = 'تعذّر الاتصال بـ Unknown AI.';
          if (response.status === 401) {
            errMsg = 'الرابط محمي بصلاحية الدخول (401). يرجى فتح الرابط العام أو تعطيل Deployment Protection في إعدادات الاستضافة.';
          } else if (response.status === 404) {
            errMsg = 'مسار الخادم غير متاح (404). يرجى إعادة رفع آخر نسخة من المشروع شاملة مجلد api.';
          }
          try {
            const errJson = (await response.json()) as { error?: string };
            if (errJson.error) errMsg = errJson.error;
          } catch {
            // Keep status-aware message
          }
          throw new Error(errMsg);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new Error('لم يرد مسار الخادم بالاستجابة الصحيحة. تأكد من رفع ملفات api وvercel.json وإضافة مفتاح GEMINI_API_KEY.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processEventBlock = (block: string) => {
          const dataLine = block
            .split(/\r?\n/)
            .find((line) => line.startsWith('data: '));
          if (!dataLine) return;

          const jsonStr = dataLine.slice(6).trim();
          if (!jsonStr) return;

          let event: {
            type?: string;
            text?: string;
            image?: GeneratedImage;
            sources?: GroundingSource[];
            error?: string;
          };
          try {
            event = JSON.parse(jsonStr);
          } catch {
            return;
          }

          if (event.type === 'delta' && typeof event.text === 'string') {
            accumulatedText += event.text;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, text: accumulatedText } : m
                      ),
                    }
                  : c
              )
            );
          } else if (event.type === 'image' && event.image?.dataUrl) {
            generatedImages = [...generatedImages, event.image];
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      updatedAt: Date.now(),
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, generatedImages } : m
                      ),
                    }
                  : c
              )
            );
          } else if (event.type === 'sources' && Array.isArray(event.sources)) {
            sources = event.sources;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, sources } : m
                      ),
                    }
                  : c
              )
            );
          } else if (event.type === 'error') {
            throw new Error(event.error || 'حدث خطأ أثناء توليد الإجابة.');
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n\r?\n/);
          buffer = lines.pop() ?? '';

          for (const block of lines) {
            processEventBlock(block);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          processEventBlock(buffer);
        }

        if (!accumulatedText.trim() && generatedImages.length === 0) {
          throw new Error(
            'تعذّر على Unknown AI توليد إجابة لهذه الرسالة. يرجى المحاولة مرة أخرى.'
          );
        }

        if (shouldAutoTitle && (accumulatedText.trim().length > 0 || generatedImages.length > 0)) {
          void generateConversationTitle(
            convId,
            firstUserPrompt,
            accumulatedText || 'إنشاء صورة بالذكاء الاصطناعي'
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const messageText =
          err instanceof Error
            ? err.message
            : 'تعذّر توليد إجابة في الوقت الحالي. يرجى المحاولة مرة أخرى.';

        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          text: accumulatedText || messageText,
                          isError: !accumulatedText && generatedImages.length === 0,
                          error: messageText,
                        }
                      : m
                  ),
                }
              : c
          )
        );
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setStreamingMessageId(null);
      }
    },
    [thinkingMode, webSearch, generateConversationTitle]
  );

  const handleSend = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (streamingMessageId) return;

      const now = Date.now();
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: now,
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'model',
        text: '',
        createdAt: now + 1,
      };

      const targetConv = conversations.find((c) => c.id === activeId);

      if (!targetConv) {
        const newConvId = crypto.randomUUID();
        const initialTitle =
          text.replace(/\s+/g, ' ').slice(0, 40).trim() ||
          attachments[0]?.name ||
          'محادثة جديدة';

        const newConv: Conversation = {
          id: newConvId,
          title: initialTitle,
          messages: [userMsg, assistantMsg],
          createdAt: now,
          updatedAt: now,
        };

        setConversations((prev) => [newConv, ...prev]);
        setActiveId(newConvId);
        setTimeout(() => scrollToBottom('auto'), 20);
        void streamResponse(newConvId, [userMsg], assistantMsg.id, true, text || initialTitle);
      } else {
        const priorMessages = [...targetConv.messages, userMsg];
        const isFirstTurn = targetConv.messages.length === 0;

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConv.id
              ? {
                  ...c,
                  updatedAt: now,
                  messages: [...c.messages, userMsg, assistantMsg],
                }
              : c
          )
        );
        setTimeout(() => scrollToBottom('smooth'), 20);
        void streamResponse(
          targetConv.id,
          priorMessages,
          assistantMsg.id,
          isFirstTurn,
          text
        );
      }
    },
    [activeId, conversations, scrollToBottom, streamResponse, streamingMessageId]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingMessageId(null);
  }, []);

  const handleRegenerate = useCallback(() => {
    if (!activeConversation || streamingMessageId) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    const lastMsg = msgs[msgs.length - 1];
    const historyWithoutLastAssistant =
      lastMsg.role === 'model' ? msgs.slice(0, -1) : msgs;

    if (historyWithoutLastAssistant.length === 0) return;

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'model',
      text: '',
      createdAt: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? {
              ...c,
              updatedAt: Date.now(),
              messages: [...historyWithoutLastAssistant, assistantMsg],
            }
          : c
      )
    );

    const lastUserText =
      [...historyWithoutLastAssistant].reverse().find((m) => m.role === 'user')?.text ?? '';

    void streamResponse(
      activeConversation.id,
      historyWithoutLastAssistant,
      assistantMsg.id,
      false,
      lastUserText
    );
  }, [activeConversation, streamResponse, streamingMessageId]);

  const handleRenameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        abortControllerRef.current?.abort();
        setStreamingMessageId(null);
        setActiveId(null);
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
    },
    [activeId]
  );

  const handleClearAll = useCallback(() => {
    abortControllerRef.current?.abort();
    setStreamingMessageId(null);
    setActiveId(null);
    setConversations([]);
    setExpandedMessages({});
  }, []);

  const handleToggleExpandMessage = useCallback((messageId: string) => {
    setExpandedMessages((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }, []);

  const lastAssistantIndex = useMemo(() => {
    if (!activeConversation) return -1;
    for (let i = activeConversation.messages.length - 1; i >= 0; i--) {
      if (activeConversation.messages[i].role === 'model') return i;
    }
    return -1;
  }, [activeConversation]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#FAFAFA] text-slate-900 dark:bg-[#0B0D11] dark:text-slate-100">
      <Sidebar
        isOpen={isSidebarOpen}
        onCloseMobile={() => setIsSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={(id) => {
          if (streamingMessageId) {
            abortControllerRef.current?.abort();
            setStreamingMessageId(null);
          }
          setActiveId(id);
          setShowScrollBottom(false);
        }}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onClearAll={handleClearAll}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNewChat={handleNewChat}
          thinkingMode={thinkingMode}
          onChangeThinkingMode={setThinkingMode}
          theme={theme}
          onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          activeTitle={activeConversation?.title}
        />

        <main className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex flex-1 flex-col overflow-y-auto"
          >
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <WelcomeScreen onSelectPrompt={(prompt) => handleSend(prompt, [])} />
            ) : (
              <div className="w-full flex-1 px-4 pt-4 pb-8 sm:px-6">
                {activeConversation.messages.map((message, index) => {
                  const isExpanded = Boolean(expandedMessages[message.id]);
                  return (
                    <div
                      key={message.id}
                      className={`mx-auto w-full ${isExpanded ? 'max-w-6xl' : 'max-w-3xl'}`}
                    >
                      <MessageBubble
                        message={message}
                        isStreaming={streamingMessageId === message.id}
                        isLastAssistant={index === lastAssistantIndex}
                        onRegenerate={handleRegenerate}
                        isExpanded={isExpanded}
                        onToggleExpand={() => handleToggleExpandMessage(message.id)}
                      />
                    </div>
                  );
                })}
                <div ref={bottomAnchorRef} className="h-2" />
              </div>
            )}
          </div>

          {showScrollBottom && activeConversation && (
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              aria-label="الانتقال إلى أحدث رسالة"
              className="absolute bottom-36 left-1/2 z-10 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}

          <Composer
            onSend={handleSend}
            onStop={handleStop}
            isGenerating={Boolean(streamingMessageId)}
            webSearch={webSearch}
            onToggleWebSearch={() => setWebSearch((prev) => !prev)}
            thinkingMode={thinkingMode}
            onChangeThinkingMode={setThinkingMode}
          />
        </main>
      </div>
    </div>
  );
}
