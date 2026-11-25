import { useMemo, useState } from 'react';
import {
  Check,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import type { Conversation } from '../types/chat';

interface SidebarProps {
  isOpen: boolean;
  onCloseMobile: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onClearAll: () => void;
}

interface GroupedConversations {
  label: string;
  items: Conversation[];
}

function groupConversationsByDate(items: Conversation[]): GroupedConversations[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - oneDay;
  const startOfLast7Days = startOfToday - 7 * oneDay;

  const groups: Record<string, Conversation[]> = {
    اليوم: [],
    أمس: [],
    'آخر 7 أيام': [],
    الأقدم: [],
  };

  for (const conv of items) {
    if (conv.updatedAt >= startOfToday) {
      groups['اليوم'].push(conv);
    } else if (conv.updatedAt >= startOfYesterday) {
      groups['أمس'].push(conv);
    } else if (conv.updatedAt >= startOfLast7Days) {
      groups['آخر 7 أيام'].push(conv);
    } else {
      groups['الأقدم'].push(conv);
    }
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, items: list }));
}

export function Sidebar({
  isOpen,
  onCloseMobile,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  onClearAll,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!query) return sorted;
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.messages.some((m) => m.text.toLowerCase().includes(query))
    );
  }, [conversations, searchQuery]);

  const grouped = useMemo(() => groupConversationsByDate(filtered), [filtered]);

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setDraftTitle(conv.title);
  };

  const commitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <>
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="سجل المحادثات"
        className={`fixed inset-y-0 start-0 z-40 flex w-[264px] shrink-0 flex-col border-e border-slate-200 bg-white transition-transform duration-200 ease-out dark:border-slate-800 dark:bg-[#111318] md:static ${
          isOpen ? 'translate-x-0' : 'translate-x-full md:hidden'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 px-4 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <BrandMark size={24} />
            <span
              dir="ltr"
              className="font-display text-sm font-semibold tracking-tight text-slate-900 whitespace-nowrap dark:text-slate-100"
            >
              Unknown AI
            </span>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="إغلاق القائمة الجانبية"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2.5 p-3">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onCloseMobile();
            }}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            <span className="whitespace-nowrap">محادثة جديدة</span>
          </button>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 start-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث في المحادثات..."
              aria-label="ابحث في المحادثات"
              className="h-9 w-full rounded-lg border border-slate-200 bg-transparent pe-8 ps-8.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none dark:border-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="مسح البحث"
                className="absolute top-1/2 end-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-4">
          {grouped.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <MessageSquare className="mx-auto mb-2.5 h-5 w-5 text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {searchQuery ? 'لا توجد محادثات مطابقة' : 'لا توجد محادثات بعد'}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {searchQuery
                  ? 'جرّب كلمة بحث أخرى.'
                  : 'ابدأ محادثة جديدة مع Unknown AI.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <div key={group.label}>
                  <div className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    {group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {group.items.map((conv) => {
                      const isActive = conv.id === activeId;
                      const isEditing = editingId === conv.id;

                      return (
                        <li key={conv.id} className="group relative">
                          {isEditing ? (
                            <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-800">
                              <input
                                type="text"
                                dir="auto"
                                autoFocus
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename(conv.id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                onBlur={() => commitRename(conv.id)}
                                className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 focus:outline-none dark:text-slate-100"
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  commitRename(conv.id);
                                }}
                                aria-label="حفظ العنوان"
                                className="rounded p-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div
                              className={`flex items-center rounded-lg transition-colors ${
                                isActive
                                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/90 dark:text-slate-100'
                                  : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
                              }`}
                            >
                              <button
                                type="button"
                                dir="auto"
                                onClick={() => {
                                  onSelectConversation(conv.id);
                                  onCloseMobile();
                                }}
                                className="min-w-0 flex-1 truncate px-2.5 py-2 text-start text-[13px] font-medium"
                              >
                                {conv.title}
                              </button>
                              <div className="flex shrink-0 items-center gap-0.5 pe-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => startRename(conv)}
                                  aria-label={`إعادة تسمية ${conv.title}`}
                                  className="rounded p-1 text-slate-400 hover:bg-slate-200/80 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteConversation(conv.id)}
                                  aria-label={`حذف ${conv.title}`}
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/60 dark:hover:text-red-400"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {conversations.length > 0 && (
          <div className="border-t border-slate-200/80 p-3 dark:border-slate-800/80">
            {confirmClear ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-2.5 py-2 dark:bg-slate-800/80">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  مسح كل المحادثات؟
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setConfirmClear(false);
                    }}
                    className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    مسح
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>مسح السجل</span>
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
