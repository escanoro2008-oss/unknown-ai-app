import { ArrowUpLeft, Code2, Compass, FileText, Lightbulb } from 'lucide-react';
import { BrandMark } from './BrandMark';

interface WelcomeScreenProps {
  onSelectPrompt: (prompt: string) => void;
}

const STARTER_PROMPTS = [
  {
    icon: Code2,
    title: 'تطوير وبرمجة الأكواد',
    description: 'مراجعة تصميم واجهات البرمجة، تحسين الاستعلامات، أو كتابة كود TypeScript نظيف.',
    prompt:
      'صمّم لي وسيط تحديد معدل الطلبات (Rate Limiter) بلغة TypeScript لإطار Express باستخدام خوارزمية النافذة المنزلقة واشرح المميزات والعيوب.',
  },
  {
    icon: FileText,
    title: 'صياغة وتحرير النصوص',
    description: 'تحويل الملاحظات السريعة إلى رسائل احترافية، بيانات إطلاق، أو تقارير واضحة.',
    prompt:
      'ساعدني في كتابة مذكرة إطلاق منتج احترافية وموجزة للإعلان عن منصة جديدة لتحليلات العملاء.',
  },
  {
    icon: Compass,
    title: 'البحث والتحليل',
    description: 'تبسيط المفاهيم المعقدة، مقارنة البدائل التقنية، واستخلاص المخاطر الرئيسية.',
    prompt:
      'قارن بين التخزين المؤقت على الحافة (Edge Caching) والعرض من الخادم (SSR) لمنصة محتوى عالية الزيارات.',
  },
  {
    icon: Lightbulb,
    title: 'تخطيط وبناء الأفكار',
    description: 'استكشاف زوايا المنتج، اختبار الفرضيات، وبناء خارطة طريق عملية.',
    prompt:
      'ضع لي خطة عمل مرتبة للأولويات خلال أول 30 و60 و90 يوماً لإطلاق بوابة تأهيل مطورين للشركات.',
  },
];

export function WelcomeScreen({ onSelectPrompt }: WelcomeScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <BrandMark size={34} />
        </div>
        <h1
          dir="ltr"
          className="font-display text-3xl font-semibold tracking-tight text-slate-900 text-balance sm:text-4xl dark:text-slate-100"
        >
          Unknown AI
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
          مساحة عمل هادئة ومنظمة للتفكير والكتابة والتحليل وبناء الأفكار بوضوح.
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {STARTER_PROMPTS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => onSelectPrompt(item.prompt)}
              className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-start transition-colors hover:border-slate-300 hover:bg-slate-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-slate-800 dark:bg-[#13161C] dark:hover:border-slate-700 dark:hover:bg-[#171B22]"
            >
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <ArrowUpLeft className="h-4 w-4 text-slate-300 transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-slate-600 dark:text-slate-600 dark:group-hover:text-slate-300" />
                </div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {item.title}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {item.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
