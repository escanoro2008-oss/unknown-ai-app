import { Menu, Moon, Plus, Sun } from 'lucide-react';
import { BrandMark } from './BrandMark';
import type { ThinkingMode } from '../types/chat';

interface ChatHeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  thinkingMode: ThinkingMode;
  onChangeThinkingMode: (mode: ThinkingMode) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  activeTitle?: string;
}

const THINKING_OPTIONS: { id: ThinkingMode; label: string }[] = [
  { id: 'fast', label: 'سريع' },
  { id: 'balanced', label: 'متوازن' },
  { id: 'deep', label: 'عميق' },
];

export function ChatHeader({
  isSidebarOpen,
  onToggleSidebar,
  onNewChat,
  thinkingMode,
  onChangeThinkingMode,
  theme,
  onToggleTheme,
  activeTitle,
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-[#FAFAFA]/90 px-4 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0B0D11]/90 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'إغلاق القائمة الجانبية' : 'فتح القائمة الجانبية'}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 ps-1 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <BrandMark size={26} />
          <span
            dir="ltr"
            className="font-display text-base font-semibold tracking-tight text-slate-900 whitespace-nowrap dark:text-slate-100"
          >
            Unknown AI
          </span>
        </button>

        {activeTitle && (
          <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              /
            </span>
            <span
              dir="auto"
              className="max-w-[260px] truncate text-sm text-slate-500 dark:text-slate-400"
            >
              {activeTitle}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <div
          role="group"
          aria-label="مستوى التفكير"
          className="hidden items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 sm:flex dark:border-slate-800 dark:bg-slate-900/90"
        >
          {THINKING_OPTIONS.map((option) => {
            const active = thinkingMode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChangeThinkingMode(option.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>محادثة جديدة</span>
        </button>
      </div>
    </header>
  );
}
