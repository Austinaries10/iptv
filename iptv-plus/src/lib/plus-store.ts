import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * IPTV Plus 扩展功能的独立 store（节目提醒、家长锁）。
 * 与主 store 分开持久化：不触碰主 store 的版本迁移链，删掉本文件即可整体回退。
 */

/** 节目预约提醒 */
export interface LiveReminder {
  channelUrl: string;
  channelName: string;
  title: string;
  /** 开播时间（epoch ms） */
  start: number;
  stop: number;
}

export const DEFAULT_LOCK_KEYWORDS = 'adult, xxx, 18+, 成人';

interface PlusState {
  reminders: LiveReminder[];
  /** 家长锁 PIN 的 SHA-256；空串表示未启用 */
  pinHash: string;
  /** 命中这些关键字（分组名或台名，逗号分隔、不区分大小写）的频道受家长锁保护 */
  lockKeywords: string;
  /** 本次会话是否已解锁（不持久化：刷新页面后重新上锁） */
  unlocked: boolean;
  toggleReminder: (reminder: LiveReminder) => boolean;
  removeReminder: (channelUrl: string, start: number) => void;
  /** 取出并移除已到点（开播前 1 分钟内）的提醒；已结束的提醒直接丢弃 */
  takeDueReminders: (now?: number) => LiveReminder[];
  setPinHash: (hash: string) => void;
  setLockKeywords: (keywords: string) => void;
  setUnlocked: (unlocked: boolean) => void;
}

export const usePlusStore = create<PlusState>()(
  persist(
    (set, get) => ({
      reminders: [],
      pinHash: '',
      lockKeywords: DEFAULT_LOCK_KEYWORDS,
      unlocked: false,
      toggleReminder: (reminder) => {
        const exists = get().reminders.some((r) => r.channelUrl === reminder.channelUrl && r.start === reminder.start);
        set({
          reminders: exists
            ? get().reminders.filter((r) => !(r.channelUrl === reminder.channelUrl && r.start === reminder.start))
            : [...get().reminders, reminder].sort((a, b) => a.start - b.start).slice(-100),
        });
        return !exists;
      },
      removeReminder: (channelUrl, start) =>
        set({ reminders: get().reminders.filter((r) => !(r.channelUrl === channelUrl && r.start === start)) }),
      takeDueReminders: (now = Date.now()) => {
        const due = get().reminders.filter((r) => r.start - 60_000 <= now);
        if (due.length === 0) return [];
        set({ reminders: get().reminders.filter((r) => r.start - 60_000 > now) });
        return due.filter((r) => r.stop > now);
      },
      setPinHash: (pinHash) => set({ pinHash, unlocked: false }),
      setLockKeywords: (lockKeywords) => set({ lockKeywords }),
      setUnlocked: (unlocked) => set({ unlocked }),
    }),
    {
      name: 'iptv-plus',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ reminders: s.reminders, pinHash: s.pinHash, lockKeywords: s.lockKeywords }),
      skipHydration: true,
    }
  )
);

/** 解析关键字设置为小写数组 */
export function parseLockKeywords(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/** 频道是否受家长锁保护（分组名或台名命中任一关键字） */
export function isLockedChannel(channel: { name: string; group?: string }, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const haystack = `${channel.group || ''}\n${channel.name}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k));
}

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`iptv-plus:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
