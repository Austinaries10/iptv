'use client';

import { useLang, type Lang } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SectionTitle } from './settings-shared';
import { useTheme, type ThemeChoice } from './theme';

/** 设置 → 偏好设置 → 语言与外观：中英切换 + 深色 / 浅色 / 跟随系统 */
export function AppearancePanel() {
  const { lang, setLang, t } = useLang();
  const { theme, setTheme } = useTheme();
  const langs: { value: Lang; label: string }[] = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ];
  const themes: { value: ThemeChoice; label: string; icon: string }[] = [
    { value: 'dark', label: t('深色', 'Dark'), icon: '🌙' },
    { value: 'light', label: t('浅色', 'Light'), icon: '☀️' },
    { value: 'system', label: t('跟随系统', 'System'), icon: '🖥️' },
  ];
  return (
    <section className="space-y-6">
      <div>
        <SectionTitle title={t('语言', 'Language')} hint={t('界面显示语言', 'Display language of the app')} />
        <Segmented options={langs} value={lang} onChange={setLang} />
      </div>
      <div>
        <SectionTitle title={t('主题', 'Theme')} hint={t('深色适合晚上与电视观看', 'Dark is best at night and on TV')} />
        <Segmented
          options={themes.map((o) => ({ value: o.value, label: `${o.icon} ${o.label}` }))}
          value={theme}
          onChange={setTheme}
        />
      </div>
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={cn(
            'tv-focus rounded-lg border px-3 py-3 text-sm font-medium transition-colors',
            value === o.value ? 'border-accent bg-accent text-on-accent' : 'border-line bg-chip text-muted hover:text-content'
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
