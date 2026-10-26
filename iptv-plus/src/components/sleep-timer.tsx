'use client';

import { useEffect, useState } from 'react';
import { Dropdown, type DropdownOption } from './dropdown';
import { useToast } from './toast';

const OPTIONS = [0, 15, 30, 60, 90, 120];

/**
 * 睡眠定时：到点调用 onFire（直播页据此卸载播放器停止拉流）。
 * 选项文案随剩余时间刷新（每 15 秒），便于确认还剩多久。
 */
export function SleepTimerButton({ onFire }: { onFire: () => void }) {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!endAt) return;
    const fire = setTimeout(() => {
      setEndAt(null);
      onFire();
      toast('睡眠定时已到，已停止播放', 'info', { duration: 8000 });
    }, Math.max(0, endAt - Date.now()));
    const tick = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => {
      clearTimeout(fire);
      clearInterval(tick);
    };
  }, [endAt, onFire, toast]);

  const left = endAt ? Math.max(1, Math.ceil((endAt - Date.now()) / 60_000)) : 0;
  const options: DropdownOption[] = OPTIONS.map((m) => ({
    value: String(m),
    label: m === 0 ? (endAt ? `⏾ 剩 ${left} 分钟` : '⏾ 睡眠定时') : `⏾ ${m} 分钟后停止`,
  }));
  // 关闭项在计时中显示剩余时间，选它即取消
  options[0].hint = endAt ? '选此项取消定时' : undefined;

  return (
    <Dropdown
      ariaLabel="睡眠定时"
      value="0"
      options={options}
      className="text-xs"
      onChange={(v) => {
        const minutes = Number(v);
        if (!minutes) {
          if (endAt) toast('已取消睡眠定时');
          setEndAt(null);
          return;
        }
        setEndAt(Date.now() + minutes * 60_000);
        toast(`将在 ${minutes} 分钟后停止播放`);
      }}
    />
  );
}
