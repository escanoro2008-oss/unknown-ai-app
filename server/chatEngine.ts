import type { IncomingMessage as HttpIncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Content, Part } from '@google/genai';

const MODEL_ID = 'gemini-4-hydrogen';
const FALLBACK_MODEL_ID = 'gemini-3.1-flash-lite';

export interface IncomingAttachment {
  name: string;
  mimeType: string;
  data: string;
  isText?: boolean;
}

export interface ChatHistoryMessage {
  role: 'user' | 'model';
  text: string;
  attachments?: IncomingAttachment[];
}

export interface ChatStreamBody {
  messages?: ChatHistoryMessage[];
  thinkingMode?: 'fast' | 'balanced' | 'deep';
  webSearch?: boolean;
  timeZone?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export type ServerReq = HttpIncomingMessage & {
  body?: unknown;
  protocol?: string;
};

export type ServerRes = ServerResponse;

const DEFAULT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image';
const degradedModelUntil = new Map<string, number>();

function getGenAIClient(customKey?: string): GoogleGenAI {
  const apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getImageGenAIClient(): GoogleGenAI {
  const imageKey = process.env.IMAGE_API_KEY?.trim();
  return getGenAIClient(imageKey || undefined);
}

function sendJson(res: ServerRes, statusCode: number, data: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readJsonBody<T>(req: ServerReq): Promise<T | null> {
  if (req.body && typeof req.body === 'object') {
    return req.body as T;
  }
  if (typeof req.body === 'string' && req.body.trim().length > 0) {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return null;
    }
  }

  if (req.readableEnded) {
    return null;
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 24 * 1024 * 1024;

    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes <= maxBytes) {
        chunks.push(buf);
      }
    });

    req.on('end', () => {
      if (chunks.length === 0 || totalBytes > maxBytes) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
      } catch {
        resolve(null);
      }
    });

    req.on('error', () => resolve(null));
  });
}

export function resolveBaseUrl(req: ServerReq): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL' && /^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto =
    typeof protoHeader === 'string'
      ? protoHeader.split(',')[0].trim()
      : req.protocol || 'https';
  const hostHeader = req.headers['x-forwarded-host'];
  const host =
    typeof hostHeader === 'string'
      ? hostHeader.split(',')[0].trim()
      : (typeof req.headers.host === 'string' ? req.headers.host : 'localhost:3000');
  return `${proto}://${host}`;
}

function mapThinkingLevel(mode?: string): ThinkingLevel {
  switch (mode) {
    case 'fast':
      return ThinkingLevel.LOW;
    case 'deep':
      return ThinkingLevel.HIGH;
    case 'balanced':
    default:
      return ThinkingLevel.MEDIUM;
  }
}

function getCurrentDateContext(requestedZone?: string) {
  const now = new Date();
  let resolvedZone = 'UTC';

  if (requestedZone && typeof requestedZone === 'string') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: requestedZone }).format(now);
      resolvedZone = requestedZone;
    } catch {
      resolvedZone = 'UTC';
    }
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const yearNum = Number(parts.find((p) => p.type === 'year')?.value ?? now.getUTCFullYear());
  const monthStr =
    parts.find((p) => p.type === 'month')?.value ?? String(now.getUTCMonth() + 1).padStart(2, '0');
  const dayStr =
    parts.find((p) => p.type === 'day')?.value ?? String(now.getUTCDate()).padStart(2, '0');
  const isoDate = `${yearNum}-${monthStr}-${dayStr}`;

  const arabicDate = new Intl.DateTimeFormat('ar-EG', {
    timeZone: resolvedZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const englishDate = new Intl.DateTimeFormat('en-US', {
    timeZone: resolvedZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const timeString = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolvedZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  return {
    year: yearNum,
    isoDate,
    arabicDate,
    englishDate,
    timeString,
    resolvedZone,
  };
}

interface Cached2026Digest {
  fetchedAt: number;
  summary: string;
  sources: GroundingSource[];
}

let cached2026Digest: Cached2026Digest | null = null;
const DIGEST_TTL_MS = 3 * 60 * 60 * 1000;

function decodeXmlEntities(input: string): string {
  return input
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function cleanWebQuery(text: string): string {
  return text
    .replace(/[؟?!.,،؛:()\[\]"]/g, ' ')
    .replace(
      /(?:^|\s)(?:ما هي|ما هو|ماهي|ماهو|أبرز|ابرز|من|متى|أين|اين|كيف|لماذا|كم|هل|حدثني عن|اخبرني عن|أخبرني عن|اعطني|أعطني|كل شيء عن|احكيلي عن|حدثه|بكل|احداثها|حاجه فيها|في|عن|على|إلى|الى|what|are|is|the|who|when|where|how|why|tell me about|latest|recent)(?=$|\s)/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function isArabicText(text: string): boolean {
  const ar = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  return ar >= en;
}

function shouldFetchLiveContext(text: string, webSearchEnabled: boolean): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length < 2) return false;

  const pureGreetingOrIdentity =
    /^(مرحبا|مرحباً|اهلا|أهلا|أهلاً|السلام عليكم|صباح الخير|مساء الخير|ازيك|إزيك|عامل ايه|شكرا|شكراً|تمام|hello|hi|hey|thanks|thank you|good morning|good evening)[!؟?.\s]*$/i.test(
      normalized
    ) ||
    /(ما اسمك|اسمك ايه|اسمك إيه|من انت|من أنت|من طورك|من صنعك|من برمجك|what is your name|who are you|who developed you|who made you|who created you)/i.test(
      normalized
    );

  if (pureGreetingOrIdentity) return false;

  const needsFreshFacts =
    /(2026|2025|٢٠٢٦|٢٠٢٥|أحداث|احداث|أخبار|اخبار|اليوم|النهاردة|النهارده|حالي|حالياً|جديد|آخر|اخر|تحديث|نتائج|نتيجة|فاز|بطل|بطولة|كأس|دوري|سعر|أسعار|اسعار|دولار|ذهب|طقس|رئيس|انتخابات|حرب|اتفاق|إصدار|اصدار|نموذج|news|latest|today|current|happened|events|winner|won|world cup|olympics|price|weather|election|president|release)/i.test(
      normalized
    );

  if (needsFreshFacts) return true;
  if (!webSearchEnabled) return false;

  if (
    normalized.includes('```') ||
    /^(اكتب كود|صمم كود|write code|fix this code)/i.test(normalized)
  ) {
    return false;
  }

  return true;
}

async function fetchGoogleNewsRss(
  query: string,
  lang: 'ar' | 'en',
  limit = 5
): Promise<{ lines: string[]; sources: GroundingSource[] }> {
  if (!query) return { lines: [], sources: [] };
  const localeParams =
    lang === 'ar' ? 'hl=ar&gl=EG&ceid=EG:ar' : 'hl=en-US&gl=US&ceid=US:en';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${localeParams}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return { lines: [], sources: [] };
    const xml = await res.text();
    const matches = [
      ...xml.matchAll(
        /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>(?:[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>)?/g
      ),
    ].slice(0, limit);

    const lines: string[] = [];
    const sources: GroundingSource[] = [];
    for (const m of matches) {
      const title = decodeXmlEntities(m[1] ?? '');
      const link = decodeXmlEntities(m[2] ?? '');
      const pubDate = decodeXmlEntities(m[3] ?? '');
      if (!title) continue;
      lines.push(`- ${title}${pubDate ? ` (${pubDate})` : ''}`);
      if (link && /^https?:\/\//i.test(link)) {
        sources.push({ title, uri: link });
      }
    }
    return { lines, sources };
  } catch {
    return { lines: [], sources: [] };
  }
}

async function fetchWikipediaSummaryByTitle(
  lang: 'ar' | 'en',
  title: string,
  exchars = 1800
): Promise<{ title: string; extract: string; url: string } | null> {
  try {
    const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&exchars=${exchars}&titles=${encodeURIComponent(
      title
    )}&format=json`;
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(3500),
      headers: { 'User-Agent': 'UnknownAI/1.0' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { title?: string; extract?: string }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    const extract = page?.extract?.trim();
    if (!extract) return null;
    const finalTitle = page?.title || title;
    return {
      title: finalTitle,
      extract,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(finalTitle.replace(/ /g, '_'))}`,
    };
  } catch {
    return null;
  }
}

async function fetchWikipediaContext(
  query: string,
  preferArabic: boolean
): Promise<{ blocks: string[]; sources: GroundingSource[] }> {
  if (!query) return { blocks: [], sources: [] };
  const primaryLang: 'ar' | 'en' = preferArabic ? 'ar' : 'en';
  const blocks: string[] = [];
  const sources: GroundingSource[] = [];
  const seenUrls = new Set<string>();

  try {
    const searchUrl = `https://${primaryLang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=2&prop=langlinks|extracts&lllang=en&exintro=true&explaintext=true&exchars=1100&format=json`;

    const enDirectPromise =
      primaryLang === 'ar'
        ? fetch(
            `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
              query
            )}&gsrlimit=2&prop=extracts&exintro=true&explaintext=true&exchars=1400&format=json`,
            { signal: AbortSignal.timeout(3500), headers: { 'User-Agent': 'UnknownAI/1.0' } }
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);

    const [primaryRes, enDirectData] = await Promise.all([
      fetch(searchUrl, {
        signal: AbortSignal.timeout(3500),
        headers: { 'User-Agent': 'UnknownAI/1.0' },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      enDirectPromise,
    ]);

    type WikiPage = {
      title?: string;
      extract?: string;
      langlinks?: Array<{ lang: string; '*': string }>;
    };

    const primaryPages = Object.values(
      ((primaryRes as { query?: { pages?: Record<string, WikiPage> } } | null)?.query?.pages) ?? {}
    );

    const enTitlesToFetch: string[] = [];

    for (const p of primaryPages) {
      if (p.title && p.extract) {
        const url = `https://${primaryLang}.wikipedia.org/wiki/${encodeURIComponent(
          p.title.replace(/ /g, '_')
        )}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          sources.push({ title: `${p.title} — ويكيبيديا`, uri: url });
          blocks.push(`[${p.title}]: ${p.extract}`);
        }
      }
      const enTitle = p.langlinks?.find((l) => l.lang === 'en')?.['*'];
      if (enTitle && primaryLang === 'ar') {
        enTitlesToFetch.push(enTitle);
      }
    }

    if (enTitlesToFetch.length > 0) {
      const enLinked = await Promise.all(
        enTitlesToFetch.slice(0, 2).map((t) => fetchWikipediaSummaryByTitle('en', t, 2000))
      );
      for (const item of enLinked) {
        if (item && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          sources.push({ title: `${item.title} (Wikipedia)`, uri: item.url });
          blocks.push(`[${item.title} - Detailed 2026 Record]: ${item.extract}`);
        }
      }
    }

    const enDirectPages = Object.values(
      ((enDirectData as { query?: { pages?: Record<string, WikiPage> } } | null)?.query?.pages) ??
        {}
    );
    for (const p of enDirectPages) {
      if (p.title && p.extract) {
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(
          p.title.replace(/ /g, '_')
        )}`;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          sources.push({ title: `${p.title} (Wikipedia)`, uri: url });
          blocks.push(`[${p.title}]: ${p.extract}`);
        }
      }
    }
  } catch {
    // Ignore failed Wikipedia lookup
  }

  return { blocks, sources };
}

async function get2026WorldDigest(): Promise<Cached2026Digest> {
  if (cached2026Digest && Date.now() - cached2026Digest.fetchedAt < DIGEST_TTL_MS) {
    return cached2026Digest;
  }

  const [wiki2026, arWorldNews, enWorldNews] = await Promise.all([
    fetchWikipediaSummaryByTitle('en', '2026', 4800),
    fetchGoogleNewsRss('أهم أحداث 2026', 'ar', 5),
    fetchGoogleNewsRss('major world events 2026', 'en', 4),
  ]);

  const sections: string[] = [];
  const sources: GroundingSource[] = [];

  if (wiki2026) {
    sections.push(`ملخص أحداث عام 2026 عالمياً (موسوعي محدث):\n${wiki2026.extract}`);
    sources.push({ title: '2026 Global Events — Wikipedia', uri: wiki2026.url });
  }
  if (arWorldNews.lines.length > 0) {
    sections.push(`أحدث العناوين العربية حول 2026:\n${arWorldNews.lines.join('\n')}`);
    sources.push(...arWorldNews.sources.slice(0, 2));
  }
  if (enWorldNews.lines.length > 0) {
    sections.push(`Latest 2026 Global Headlines:\n${enWorldNews.lines.join('\n')}`);
    sources.push(...enWorldNews.sources.slice(0, 2));
  }

  const digest: Cached2026Digest = {
    fetchedAt: Date.now(),
    summary: sections.join('\n\n'),
    sources,
  };

  if (sections.length > 0) {
    cached2026Digest = digest;
  }

  return digest;
}

async function fetchLiveWebContext(
  userText: string
): Promise<{ contextText: string; sources: GroundingSource[] }> {
  const preferArabic = isArabicText(userText);
  const cleaned = cleanWebQuery(userText);
  const query = cleaned.length >= 2 ? cleaned : userText.trim().slice(0, 100);

  const [digest, arNews, enNews, wiki] = await Promise.all([
    get2026WorldDigest(),
    preferArabic
      ? fetchGoogleNewsRss(query, 'ar', 5)
      : Promise.resolve({ lines: [] as string[], sources: [] as GroundingSource[] }),
    fetchGoogleNewsRss(query, 'en', preferArabic ? 3 : 5),
    fetchWikipediaContext(query, preferArabic),
  ]);

  const parts: string[] = [];
  const sourceMap = new Map<string, GroundingSource>();

  const addSources = (list: GroundingSource[]) => {
    for (const s of list) {
      if (s.uri && !sourceMap.has(s.uri) && sourceMap.size < 6) {
        sourceMap.set(s.uri, s);
      }
    }
  };

  if (wiki.blocks.length > 0) {
    parts.push(`معلومات مرجعية مرتبطة بالسؤال:\n${wiki.blocks.join('\n\n')}`);
    addSources(wiki.sources);
  }
  if (arNews.lines.length > 0) {
    parts.push(`نتائج الأخبار العربية الحية:\n${arNews.lines.join('\n')}`);
    addSources(arNews.sources);
  }
  if (enNews.lines.length > 0) {
    parts.push(`Live Global News Results:\n${enNews.lines.join('\n')}`);
    addSources(enNews.sources);
  }
  if (digest.summary) {
    parts.push(digest.summary);
    addSources(digest.sources);
  }

  return {
    contextText: parts.join('\n\n---\n\n'),
    sources: Array.from(sourceMap.values()),
  };
}

function buildGeminiContents(messages: ChatHistoryMessage[]): Content[] {
  return messages
    .filter((msg) => {
      const text = typeof msg.text === 'string' ? msg.text : '';
      return text.trim().length > 0 || (msg.attachments && msg.attachments.length > 0);
    })
    .map((msg) => {
      const parts: Part[] = [];
      const text = typeof msg.text === 'string' ? msg.text : '';

      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (attachment.isText) {
            parts.push({
              text: `[Attached file: ${attachment.name}]\n${attachment.data}`,
            });
          } else if (attachment.data && attachment.mimeType) {
            parts.push({
              inlineData: {
                mimeType: attachment.mimeType,
                data: attachment.data,
              },
            });
          }
        }
      }

      if (text.trim().length > 0) {
        parts.push({ text });
      } else if (parts.length > 0) {
        parts.push({ text: 'يرجى تحليل هذه الصورة ووصفها بوضوح.' });
      }

      return {
        role: msg.role === 'model' ? 'model' : 'user',
        parts,
      };
    });
}

function formatErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.includes('GEMINI_API_KEY') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED')
  ) {
    return 'تعذّر التحقق من صلاحية الاتصال بخدمة الذكاء الاصطناعي. يرجى مراجعة إعدادات المفتاح في الخادم.';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'تم الوصول إلى الحد الأقصى للطلبات حالياً. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.';
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return 'تشهد خدمة الذكاء الاصطناعي ضغطاً مؤقتاً في هذه اللحظة. يرجى المحاولة مرة أخرى بعد ثوانٍ.';
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return 'نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة مرة أخرى.';
  }
  if (raw.includes('Unable to process input image') || raw.includes('INVALID_ARGUMENT')) {
    return 'تعذّرت معالجة الصورة المرفوعة. يرجى تجربة صورة بصيغة PNG أو JPEG أو WebP.';
  }
  if (
    raw.includes('fetch failed') ||
    raw.includes('ECONNREFUSED') ||
    raw.includes('ETIMEDOUT')
  ) {
    return 'حدث خطأ في الشبكة أثناء الاتصال بخدمة الذكاء الاصطناعي. يرجى التحقق من الاتصال والمحاولة مرة أخرى.';
  }
  if (raw.includes('MODEL_STARTUP_TIMEOUT') || raw.includes('UPSTREAM_TIMEOUT')) {
    return 'استغرقت خدمة الذكاء الاصطناعي وقتاً طويلاً للاستجابة. يرجى المحاولة مرة أخرى.';
  }
  return 'تعذّر توليد إجابة في الوقت الحالي. يرجى المحاولة مرة أخرى.';
}

type RequestIntent =
  | 'chat'
  | 'text-enhance'
  | 'image-generate'
  | 'image-edit'
  | 'image-enhance';

function detectRequestIntent(
  text: string,
  hasImageAttachment: boolean
): RequestIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (hasImageAttachment) {
    const isVisionQuestion =
      /^(?:ما|ماذا|كم|هل|لماذا|ليه|كيف|أين|اين|متى|من|صف|اشرح|حلّل|حلل|اقرأ|استخرج|ترجم|اقترح|what|which|how|why|who|where|when|is|are|can you|describe|analyze|analyse|explain|read|extract|translate|suggest)(?=$|[\s؟?!.,،:])/i.test(
        lower
      );
    if (isVisionQuestion) {
      return 'chat';
    }

    const wantsImageEnhance =
      /(?:^|\s)(?:حسّ?ن|حسن|تحسين|صفّ?ي|صفي|وضّ?ح|وضح|ارفع\s+جودة|رفع\s+جودة|توضيح|إزالة\s+التشويش|ازالة\s+التشويش|enhance|upscale|sharpen|denoise|restore|improve\s+(?:the\s+)?(?:quality|resolution|clarity|lighting))(?=$|[\s؟?!.,،:])/i.test(
        lower
      ) && !/(?:البرومبت|النص|الوصف|prompt|text|caption)/i.test(lower);

    if (wantsImageEnhance) {
      return 'image-enhance';
    }

    const wantsImageEdit =
      /^(?:عدّل|عدل|غيّر|غير|أزل|ازل|احذف|أضف|اضف|بدّل|بدل|حوّل|حول|ارسم على)(?=$|[\s؟?!.,،:])|(?:عدّل|عدل|غيّر|غير|أزل|ازل|احذف|أضف|اضف|بدّل|بدل|حوّل|حول)\s+(?:هذه\s+|ال)?(?:الصورة|الخلفية|الألوان|الإضاءة|الملابس|الوجه)|(?:edit|modify|remove background|change background|add .+ to|transform|retouch)\s+(?:this\s+|the\s+)?(?:image|photo|picture)/i.test(
        lower
      );
    return wantsImageEdit ? 'image-edit' : 'chat';
  }

  const isQuestionOrCoding =
    /^(?:كيف|لماذا|ليه|ما هو|ما هي|ماهو|ماهي|هل|متى|أين|اين|كم|من هو|شرح|اشرح|وضّح|وضح|اكتب كود|برمج|صمم موقع|how to|how do|why|what is|what are|explain|write code|code for)(?=$|[\s؟?!.,،:])/i.test(
      lower
    ) ||
    /(```|\bhtml\b|\bcss\b|\breact\b|\bjavascript\b|\btypescript\b|\bpython\b|\bsql\b|\bapi\b|\bwebsite\b|\bwebpage\b|(?:^|\s)(?:كود|برمجة|استعلام|موقع|صفحة ويب|تطبيق|خطة|جدول)(?=$|[\s؟?!.,،:]))/i.test(
      lower
    );

  if (isQuestionOrCoding) {
    return 'chat';
  }

  const wantsImageGeneration =
    /(?:ارسم|إرسم|ارسمي|صمّم|صمم|أنشئ|انشئ|اصنع|ولّد|ولد|أنتج|انتج|كوّن|كون|اعمل|سوّي|سوي|ابغى|أبغى|عايز|أريد|اعطني|أعطني|هات)\s+(?:لي\s+)?(?:صورة|صور|رسمة|رسمه|لوجو|شعار|بوستر|ملصق|خلفية|أيقونة|ايقونة|تصميم(?:اً)?\s+(?:لـ|عن|صورة))/i.test(
      lower
    ) ||
    /^(?:من فضلك\s+|لو سمحت\s+|ممكن\s+)?(?:ارسم|إرسم|ارسمي)\s+(?:لي\s+)?\S+/i.test(
      lower
    ) ||
    /^(?:توليد صورة|إنشاء صورة|انشاء صورة|رسم صورة|صورة\s+(?:لـ|عن|تظهر|توضح|واقعية|كرتونية|ثلاثية|3d|hd|4k))/i.test(
      lower
    ) ||
    /^(?:please\s+|can you\s+)?(?:draw|paint|sketch|illustrate|render)\s+(?:me\s+)?\S+/i.test(
      lower
    ) ||
    /(?:generate|create|draw|paint|sketch|render|design|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|illustration|artwork|logo|wallpaper|poster|icon)\b/i.test(
      lower
    ) ||
    /^(?:image of|picture of|photo of|illustration of)\b/i.test(lower);

  if (wantsImageGeneration) {
    return 'image-generate';
  }

  const wantsTextEnhancement =
    /(?:حسّ?ن|حسن|تحسين|طوّ?ر|صُغ|صغ|أعد\s+صياغة|اعد\s+صياغة|إعادة\s+صياغة|رتّ?ب|صحّ?ح|دقّ?ق|نقّ?ح)\s+(?:لي\s+)?(?:هذا\s+|هذه\s+|ال)?(?:النص|الكلام|الكتابة|الصياغة|الأسلوب|الفقرة|المقال|الرسالة|الإيميل|البريد|الإجابة|الرد|الوصف|البرومبت|المحتوى|المنشور|التغريدة|الخطاب|إجابتك|ردك|الجملة|العبارة)/i.test(
      lower
    ) ||
    /^(?:من فضلك\s+|لو سمحت\s+|ممكن\s+)?(?:حسّ?ن|أعد\s+صياغة|اعد\s+صياغة|صحّ?ح|دقّ?ق|نقّ?ح)(?=$|[\s؟?!.,،:])/i.test(
      lower
    ) ||
    /(?:improve|enhance|polish|refine|rewrite|rephrase|proofread|fix\s+(?:the\s+)?grammar|make\s+(?:this|it)\s+(?:better|more\s+professional|clearer|more\s+formal))\b/i.test(
      lower
    );

  return wantsTextEnhancement ? 'text-enhance' : 'chat';
}

function detectAspectRatio(text: string): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  const lower = text.toLowerCase();
  if (/16:9|عرضي|أفقي|landscape|widescreen|banner|youtube/i.test(lower)) return '16:9';
  if (/9:16|طولي|رأسي|عمودي|portrait|story|reel|mobile|wallpaper/i.test(lower)) return '9:16';
  if (/4:3/.test(lower)) return '4:3';
  if (/3:4/.test(lower)) return '3:4';
  return '1:1';
}

function formatImageErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.includes('GEMINI_API_KEY') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('403') ||
    raw.includes('429')
  ) {
    return 'تعذّر تنفيذ طلب الصورة عبر API: نموذج توليد الصور يتطلب مفتاحاً مفعّلاً عليه الفوترة لـ GEMINI_API_KEY أو توفير مفتاح منفصل لتوليد الصور (IMAGE_API_KEY) في إعدادات الخادم أو Vercel.';
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return 'تشهد خدمة توليد الصور ضغطاً مؤقتاً الآن. يرجى المحاولة مرة أخرى بعد لحظات.';
  }
  if (raw.includes('INVALID_ARGUMENT') || raw.includes('Unable to process input image')) {
    return 'تعذّرت معالجة الصورة المرفوعة. يرجى تجربة صورة بصيغة PNG أو JPEG أو WebP.';
  }
  return 'تعذّر توليد أو تحسين الصورة عبر API في الوقت الحالي. يرجى التحقق من إعدادات مفتاح API والمحاولة مرة أخرى.';
}

function isTransientNetworkError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('502') ||
    raw.includes('500') ||
    raw.includes('ECONNRESET') ||
    raw.includes('ETIMEDOUT')
  );
}

function shouldFallbackModel(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  return (
    name === 'AbortError' ||
    raw.includes('MODEL_STARTUP_TIMEOUT') ||
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('high demand') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('429') ||
    raw.includes('NOT_FOUND') ||
    raw.includes('404') ||
    isTransientNetworkError(err)
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isTransientNetworkError(err)) {
        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export function handleHealthRequest(_req: ServerReq, res: ServerRes): void {
  sendJson(res, 200, {
    status: 'ok',
    brand: 'Unknown AI',
    configured: Boolean(process.env.GEMINI_API_KEY),
  });
}

export function handleRobotsRequest(req: ServerReq, res: ServerRes): void {
  const baseUrl = resolveBaseUrl(req);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
}

export function handleSitemapRequest(req: ServerReq, res: ServerRes): void {
  const baseUrl = resolveBaseUrl(req);
  const today = new Date().toISOString().split('T')[0];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.end(xml);
}

export async function handleChatStreamRequest(req: ServerReq, res: ServerRes): Promise<void> {
  const body = await readJsonBody<ChatStreamBody>(req);
  const messages = Array.isArray(body?.messages) ? body.messages : [];

  if (messages.length === 0) {
    sendJson(res, 400, { error: 'يرجى كتابة رسالة قبل الإرسال.' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as ServerRes & { flushHeaders?: () => void }).flushHeaders?.();

  const streamAbortController = new AbortController();
  const timeoutId = setTimeout(() => {
    streamAbortController.abort(new Error('UPSTREAM_TIMEOUT'));
  }, 55000);

  let clientClosed = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      streamAbortController.abort(new Error('CLIENT_ABORTED'));
    }
  });

  const sendEvent = (payload: Record<string, unknown>) => {
    if (!clientClosed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  if (!clientClosed && !res.writableEnded) {
    res.write(': connected\n\n');
  }

  const keepAliveTimer = setInterval(() => {
    if (!clientClosed && !res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 8000);

  try {
    const ai = getGenAIClient();
    const contents = buildGeminiContents(messages);
    if (contents.length === 0) {
      sendEvent({ type: 'error', error: 'يرجى كتابة رسالة غير فارغة.' });
      res.end();
      return;
    }

    const thinkingLevel = mapThinkingLevel(body?.thinkingMode);
    const dateCtx = getCurrentDateContext(body?.timeZone);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const lastUserText =
      typeof lastUserMessage?.text === 'string' ? lastUserMessage.text : '';
    const imageAttachments = (lastUserMessage?.attachments ?? []).filter(
      (att) => !att.isText && att.mimeType.startsWith('image/') && Boolean(att.data)
    );
    const hasImageAttachment = imageAttachments.length > 0;
    const intent = detectRequestIntent(lastUserText, hasImageAttachment);

    if (
      intent === 'image-generate' ||
      intent === 'image-enhance' ||
      intent === 'image-edit'
    ) {
      try {
        const imageAi = getImageGenAIClient();
        const configuredImageModel =
          process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL_ID;
        const imageModels =
          configuredImageModel === DEFAULT_IMAGE_MODEL_ID
            ? [DEFAULT_IMAGE_MODEL_ID, 'gemini-3.1-flash-image']
            : [configuredImageModel, DEFAULT_IMAGE_MODEL_ID];

        const parts: Part[] = [];
        for (const img of imageAttachments) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data,
            },
          });
        }

        const imagePromptText =
          intent === 'image-enhance'
            ? lastUserText.trim()
              ? `Enhance and upscale the quality, sharpness, lighting balance, and natural details of the attached image while preserving its identity and composition. Additional instructions: ${lastUserText.trim()}`
              : 'Enhance and upscale the quality, sharpness, clarity, color balance, and fine details of the attached image naturally while preserving the original subject and composition.'
            : lastUserText.trim();

        parts.push({ text: imagePromptText });

        let imageResult:
          | {
              imageUrl: string;
              mimeType: string;
              text: string;
            }
          | undefined;
        let lastImageErr: unknown = null;

        for (const modelId of imageModels) {
          if (clientClosed) break;
          try {
            const response = await imageAi.models.generateContent({
              model: modelId,
              contents: { parts },
              config: {
                ...(intent === 'image-generate'
                  ? { imageConfig: { aspectRatio: detectAspectRatio(lastUserText) } }
                  : {}),
                abortSignal: streamAbortController.signal,
              },
            });

            let foundDataUrl = '';
            let foundMime = 'image/png';
            const textParts: string[] = [];

            for (const part of response.candidates?.[0]?.content?.parts ?? []) {
              if (part.inlineData?.data) {
                foundMime = part.inlineData.mimeType || 'image/png';
                foundDataUrl = `data:${foundMime};base64,${part.inlineData.data}`;
              } else if (part.text) {
                textParts.push(part.text);
              }
            }

            if (foundDataUrl) {
              imageResult = {
                imageUrl: foundDataUrl,
                mimeType: foundMime,
                text: textParts.join('\n').trim(),
              };
              break;
            }
            lastImageErr = new Error(
              textParts.join(' ').trim() || 'Model returned no image output.'
            );
          } catch (err) {
            lastImageErr = err;
            const raw = err instanceof Error ? err.message : String(err);
            const tryNext =
              raw.includes('NOT_FOUND') ||
              raw.includes('404') ||
              raw.includes('503') ||
              raw.includes('UNAVAILABLE') ||
              raw.includes('429') ||
              raw.includes('RESOURCE_EXHAUSTED') ||
              raw.includes('403') ||
              raw.includes('PERMISSION_DENIED');
            if (!tryNext) break;
          }
        }

        if (!imageResult) {
          sendEvent({
            type: 'error',
            error: formatImageErrorMessage(lastImageErr),
          });
          res.end();
          return;
        }

        if (!clientClosed) {
          sendEvent({
            type: 'image',
            image: {
              dataUrl: imageResult.imageUrl,
              mimeType: imageResult.mimeType,
              prompt: lastUserText.trim() || undefined,
              mode: intent === 'image-enhance' ? 'enhanced' : 'generated',
            },
          });
          const caption =
            imageResult.text ||
            (intent === 'image-enhance'
              ? 'تم تحسين الصورة بنجاح.'
              : intent === 'image-edit'
                ? 'تم تعديل الصورة حسب طلبك.'
                : 'تم إنشاء الصورة بناءً على وصفك.');
          sendEvent({ type: 'delta', text: caption });
          sendEvent({ type: 'done' });
          res.end();
        }
      } catch (imgErr) {
        if (!clientClosed) {
          sendEvent({
            type: 'error',
            error: formatImageErrorMessage(imgErr),
          });
          res.end();
        }
      }
      return;
    }

    const useWebSearch = intent === 'chat' && body?.webSearch !== false;

    let liveContextText = '';
    let liveSources: GroundingSource[] = [];
    if (shouldFetchLiveContext(lastUserText, useWebSearch)) {
      const live = await fetchLiveWebContext(lastUserText);
      liveContextText = live.contextText;
      liveSources = live.sources;
    }

    const instructionParts: string[] = [
      'أنت Unknown AI، مساعد ذكي شامل واحترافي ودقيق وهادئ تجيب على جميع الأسئلة في كل المجالات (العلوم، البرمجة، التاريخ، الثقافة، الدراسة، الرياضة، الأخبار، الحياة اليومية، وتحليل الصور والملفات) بوضوح ومساعدة كاملة.',
      'قاعدة الاسم والهوية: اسمك هو Unknown AI. عندما يسألك أي شخص عن اسمك أو من أنت (مثل "ما اسمك؟" أو "اسمك إيه؟" أو "What is your name?"), أجب بوضوح: "اسمي Unknown AI." (وبالإنجليزية: "My name is Unknown AI.").',
      'قاعدة الترحيب والمقدمة: في التحيات والردود العادية (مثل مرحباً أو أهلاً أو Hello)، رحّب بالمستخدم بشكل طبيعي ومباشر واعرض المساعدة دون ذكر من طوّرك أو اسم الجهة المطوّرة نهائياً.',
      'قاعدة الهوية والمطور (عند السؤال فقط): لا تذكر عبارة "مطوّر من قِبل Unknown AI" إلا إذا سألك المستخدم صراحةً عن من طوّرك أو من صنعك أو من برمجك. عندئذٍ فقط أجب باختصار: "أنا مطوّر من قِبل Unknown AI." (وبالإنجليزية: "I am developed by Unknown AI."). يُمنع منعاً باتاً ذكر كلمة Google أو Gemini أو عبارة "ولست من Google" أو "not Google" في أي رد أو مقدمة.',
      `قاعدة التاريخ والوقت الحاليين: التاريخ الحالي الآن هو ${dateCtx.arabicDate} (الموافق ${dateCtx.englishDate}، بصيغة ${dateCtx.isoDate})، والساعة الآن ${dateCtx.timeString} حسب المنطقة الزمنية (${dateCtx.resolvedZone})، والسنة الحالية هي ${dateCtx.year}. اعتمد دائماً هذا التاريخ كمرجع رسمي للحاضر، وإذا سُئلت عن تاريخ اليوم أو الشهر أو السنة فأجب بهذا التاريخ الدقيق (${dateCtx.year}) ولا تقل أبداً إننا في عام 2024 أو أي عام سابق.`,
      'القواعد اللغوية الأساسية: لغتك الافتراضية والأساسية هي اللغة العربية الفصحى السلسة والواضحة، ولكن إذا كتب لك المستخدم باللغة الإنجليزية (أو بأي لغة أخرى) يجب أن تجيبه فوراً وبشكل طبيعي وكامل باللغة الإنجليزية (أو بنفس لغة المستخدم) دون الخلط بين اللغتين إلا إذا طلب المستخدم ذلك صراحة.',
      'قاعدة الصور والملفات: عند إرفاق صور، افحص تفاصيلها البصرية والنصوص والعناصر بدقة للإجابة عن سؤال المستخدم بنفس لغته.',
      'قاعدة الصدق وعدم الاختراع: إذا لم تكن متأكداً من معلومة أو تفصيل معيّن أو لم يتوفر في السياق الموثوق، فوضّح ذلك بصراحة للمستخدم ولا تخترع أو تخمّن إجابات أو أرقاماً أو مصادر غير مؤكدة.',
      'قاعدة التنسيق: استخدم تنسيق Markdown النظيف عند الحاجة، وكن موجزاً في الأسئلة البسيطة ومفصلاً ومنظماً في الطلبات التقنية أو التحليلية.',
    ];

    if (intent === 'text-enhance') {
      instructionParts.push(
        'وضع التحسين التلقائي: يطلب المستخدم الآن تحسين نص أو إجابة أو صياغة أو رسالة. مهمتك هي تحسينها من حيث الوضوح والدقة والأسلوب والتنظيم مع الحفاظ على المعنى الأصلي ولغة المستخدم. وإذا أشار المستخدم إلى إجابتك السابقة فاعتمد على سياق المحادثة. قدّم النسخة المحسّنة مباشرة وبشكل مرتب وجاهز للاستخدام.'
      );
    }

    if (liveContextText) {
      instructionParts.push(
        `قاعدة المعرفة الحية لعام ${dateCtx.year}: لديك أدناه معلومات موثوقة ومحدثة حتى اليوم (${dateCtx.isoDate}). استخدم هذه الحقائق والتواريخ والأخبار مباشرة في إجابتك بدقة وموضوعية وبأسلوب Unknown AI، ولا تقل أبداً "لا تتوفر لدي معلومات بعد فترة تدريبي" ما دامت المعلومة موجودة في السياق التالي. وإذا كانت المعلومة المطلوبة شديدة التحديد ولم ترد في النتائج، أجب بما هو مؤكد ومتاح ووضّح التفاصيل المفيدة.\n\n[بيانات محدثة لعام ${dateCtx.year} وتاريخ اليوم ${dateCtx.isoDate}]:\n${liveContextText}`
      );
    }

    const config: Record<string, unknown> = {
      systemInstruction: instructionParts.join(' '),
      thinkingConfig: {
        thinkingLevel,
      },
    };

    const tryStreamWithModel = async (modelId: string, attemptSignal: AbortSignal) => {
      const modelConfig: Record<string, unknown> = {
        systemInstruction: config.systemInstruction,
        abortSignal: attemptSignal,
      };
      if (modelId === MODEL_ID) {
        modelConfig.thinkingConfig = config.thinkingConfig;
      }
      return ai.models.generateContentStream({
        model: modelId,
        contents,
        config: modelConfig,
      });
    };

    const candidateModels = [
      MODEL_ID,
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      FALLBACK_MODEL_ID,
      'gemini-3.5-flash-lite',
    ];
    const nowMs = Date.now();
    const orderedModels = [
      ...candidateModels.filter((m) => (degradedModelUntil.get(m) ?? 0) <= nowMs),
      ...candidateModels.filter((m) => (degradedModelUntil.get(m) ?? 0) > nowMs),
    ];

    let emittedAnyText = false;
    const sourceMap = new Map<string, GroundingSource>();
    for (const src of liveSources) {
      if (src.uri && !sourceMap.has(src.uri)) {
        sourceMap.set(src.uri, src);
      }
    }

    let lastStreamErr: unknown = null;

    for (let idx = 0; idx < orderedModels.length; idx++) {
      if (clientClosed || emittedAnyText || streamAbortController.signal.aborted) break;
      const modelId = orderedModels[idx];
      const attemptController = new AbortController();
      const attemptTimeoutMs = idx === 0 ? 5500 : 8000;
      const attemptTimer = setTimeout(() => {
        attemptController.abort(new Error('MODEL_STARTUP_TIMEOUT'));
      }, attemptTimeoutMs);
      const combinedSignal = AbortSignal.any([
        streamAbortController.signal,
        attemptController.signal,
      ]);

      try {
        const stream = await withRetry(() => tryStreamWithModel(modelId, combinedSignal), 2);

        for await (const chunk of stream) {
          if (clientClosed) {
            break;
          }

          const chunkText = chunk.text;
          if (chunkText) {
            if (!emittedAnyText) {
              clearTimeout(attemptTimer);
              degradedModelUntil.delete(modelId);
            }
            emittedAnyText = true;
            sendEvent({ type: 'delta', text: chunkText });
          }

          const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (Array.isArray(groundingChunks)) {
            for (const gChunk of groundingChunks) {
              const uri = gChunk?.web?.uri;
              if (uri && !sourceMap.has(uri)) {
                sourceMap.set(uri, {
                  uri,
                  title: gChunk.web?.title || uri,
                });
              }
            }
          }
        }

        clearTimeout(attemptTimer);

        if (emittedAnyText) {
          lastStreamErr = null;
          break;
        }
      } catch (attemptErr) {
        clearTimeout(attemptTimer);
        lastStreamErr = attemptErr;
        if (emittedAnyText || clientClosed || streamAbortController.signal.aborted) {
          throw attemptErr;
        }
        const effectiveErr =
          attemptController.signal.aborted &&
          attemptController.signal.reason instanceof Error
            ? attemptController.signal.reason
            : attemptErr;
        lastStreamErr = effectiveErr;
        if (!shouldFallbackModel(effectiveErr) || idx === orderedModels.length - 1) {
          throw effectiveErr;
        }
        degradedModelUntil.set(modelId, Date.now() + 3 * 60 * 1000);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    if (!emittedAnyText && lastStreamErr) {
      throw lastStreamErr;
    }

    if (!clientClosed) {
      if (!emittedAnyText) {
        sendEvent({
          type: 'error',
          error: 'تعذّر على Unknown AI توليد إجابة لهذا الطلب. يرجى إعادة صياغة الرسالة.',
        });
        res.end();
        return;
      }
      if (sourceMap.size > 0) {
        sendEvent({ type: 'sources', sources: Array.from(sourceMap.values()) });
      }
      sendEvent({ type: 'done' });
      res.end();
    }
  } catch (err) {
    const reason = streamAbortController.signal.reason;
    if (reason instanceof Error && reason.message === 'UPSTREAM_TIMEOUT') {
      if (!clientClosed) {
        sendEvent({
          type: 'error',
          error: 'استغرقت خدمة الذكاء الاصطناعي وقتاً طويلاً للاستجابة. يرجى المحاولة مرة أخرى.',
        });
        res.end();
      }
    } else if (!clientClosed) {
      console.error('[Unknown AI] Stream error:', err instanceof Error ? err.message : err);
      sendEvent({ type: 'error', error: formatErrorMessage(err) });
      res.end();
    }
  } finally {
    clearTimeout(timeoutId);
    clearInterval(keepAliveTimer);
  }
}

export async function handleChatTitleRequest(req: ServerReq, res: ServerRes): Promise<void> {
  const body = await readJsonBody<{ prompt?: unknown; reply?: unknown }>(req);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const reply = typeof body?.reply === 'string' ? body.reply.trim() : '';

  if (!prompt) {
    sendJson(res, 400, { error: 'Prompt is required.' });
    return;
  }

  const fallbackTitle = prompt.replace(/\s+/g, ' ').slice(0, 44).trim() || 'محادثة جديدة';

  try {
    const ai = getGenAIClient();
    const titleModels = [MODEL_ID, 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
    let generatedTitle = '';

    for (const modelId of titleModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: `Generate a concise 2 to 5 word title summarizing this conversation in the exact same language as the user message (Arabic if the user wrote in Arabic, English if the user wrote in English). Return only the plain title text without quotes, punctuation, or prefixes.\n\nUser: ${prompt.slice(0, 400)}\nAssistant: ${reply.slice(0, 300)}`,
          config: {
            abortSignal: AbortSignal.timeout(8000),
            ...(modelId === MODEL_ID
              ? {
                  thinkingConfig: {
                    thinkingLevel: ThinkingLevel.LOW,
                  },
                }
              : {}),
          },
        });
        const candidate = (response.text ?? '')
          .replace(/^["'`]+|["'`]+$/g, '')
          .replace(/\n/g, ' ')
          .trim()
          .slice(0, 60);
        if (candidate) {
          generatedTitle = candidate;
          break;
        }
      } catch {
        // Try next available title model
      }
    }

    sendJson(res, 200, { title: generatedTitle || fallbackTitle });
  } catch {
    sendJson(res, 200, { title: fallbackTitle });
  }
}
