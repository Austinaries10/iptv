'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePlusStore } from '@/lib/plus-store';
import { useToast } from './toast';

const CHECK_INTERVAL_MS = 20_000;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 节目预约提醒：每 20 秒检查一次，开播前 1 分钟弹出提示（带「去观看」），
 * 页面在后台且已授权时同时发系统通知。到点的提醒即被移除，不会重复提示。
 */
export function LiveReminderWatcher() {
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const check = () => {
      const due = usePlusStore.getState().takeDueReminders();
      for (const r of due) {
        const when = r.start > Date.now() ? `${fmtTime(r.start)} 开播` : '正在播出';
        const message = `节目提醒：${r.channelName}「${r.title}」${when}`;
        const href = `/live?${new URLSearchParams({ url: r.channelUrl, name: r.channelName }).toString()}`;
        toast(message, 'info', { duration: 30_000, action: { label: '去观看', onClick: () => router.push(href) } });
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const n = new Notification('节目提醒', { body: message, icon: '/icons/icon-192.png' });
            n.onclick = () => {
              window.focus();
              router.push(href);
            };
          } catch {
            /* 部分浏览器（如安卓 Chrome）只允许 Service Worker 发通知，忽略 */
          }
        }
      }
    };
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router, toast]);

  return null;
}
