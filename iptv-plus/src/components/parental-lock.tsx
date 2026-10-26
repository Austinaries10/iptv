'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_LOCK_KEYWORDS, hashPin, usePlusStore } from '@/lib/plus-store';
import { cn } from '@/lib/utils';
import { useToast } from './toast';

/**
 * 家长锁：设置 4–8 位数字 PIN 后，分组名或台名命中关键字的频道在所有直播页面隐藏，
 * 输入 PIN 解锁（仅本次会话有效，刷新即重新上锁）。修改 / 移除 PIN 需先验证旧 PIN。
 */
export function ParentalLockButton() {
  const pinHash = usePlusStore((s) => s.pinHash);
  const unlocked = usePlusStore((s) => s.unlocked);
  const [open, setOpen] = useState(false);
  const label = !pinHash ? '🔓 家长锁' : unlocked ? '🔓 已解锁' : '🔒 已上锁';
  return (
    <>
      <button className={cn('btn-ghost text-xs', pinHash && !unlocked && 'text-warning')} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <ParentalLockDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ParentalLockDialog({ onClose }: { onClose: () => void }) {
  const { pinHash, unlocked, lockKeywords, setPinHash, setLockKeywords, setUnlocked } = usePlusStore();
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [keywords, setKeywords] = useState(lockKeywords);
  const [error, setError] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 已设 PIN 且未解锁时，敏感操作前先校验当前 PIN */
  const verify = async () => {
    if (!pinHash || unlocked) return true;
    if ((await hashPin(pin)) === pinHash) return true;
    setError('PIN 不正确');
    return false;
  };

  const unlock = async () => {
    if (!(await verify())) return;
    setUnlocked(true);
    toast('已解锁，本次会话内显示受保护频道', 'success');
    onClose();
  };

  const savePin = async () => {
    if (!/^\d{4,8}$/.test(newPin)) {
      setError('新 PIN 需为 4–8 位数字');
      return;
    }
    if (!(await verify())) return;
    setPinHash(await hashPin(newPin));
    setLockKeywords(keywords.trim() || DEFAULT_LOCK_KEYWORDS);
    toast(pinHash ? 'PIN 已修改' : '家长锁已开启', 'success');
    onClose();
  };

  const removePin = async () => {
    if (!(await verify())) return;
    setPinHash('');
    toast('家长锁已关闭');
    onClose();
  };

  const locked = Boolean(pinHash) && !unlocked;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 animate-fade-in" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="家长锁" className="relative bg-surface-raised rounded-xl w-full max-w-sm shadow-2xl p-5 animate-slide-up space-y-3">
        <h2 className="text-base font-semibold text-content">家长锁</h2>
        <p className="text-xs text-muted leading-relaxed">
          {pinHash
            ? locked
              ? '已上锁：命中关键字的频道已隐藏。输入 PIN 解锁（刷新页面后自动重新上锁）。'
              : '本次会话已解锁。'
            : '设置 PIN 后，分组名或台名包含下列关键字的频道将被隐藏，需输入 PIN 才能观看。'}
        </p>
        {locked && (
          <input
            className="input w-full text-center tracking-[0.4em]"
            type="password"
            inputMode="numeric"
            autoFocus
            maxLength={8}
            placeholder="当前 PIN"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && void unlock()}
          />
        )}
        <label className="block text-xs text-muted space-y-1">
          <span>受保护关键字（逗号分隔）</span>
          <input className="input w-full" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <label className="block text-xs text-muted space-y-1">
          <span>{pinHash ? '新 PIN（修改时填写）' : '设置 PIN（4–8 位数字）'}</span>
          <input
            className="input w-full"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={newPin}
            onChange={(e) => {
              setNewPin(e.target.value);
              setError('');
            }}
          />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          {pinHash && (
            <button className="btn-ghost text-xs text-danger" onClick={() => void removePin()}>
              关闭家长锁
            </button>
          )}
          {pinHash && !locked && (
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setUnlocked(false);
                toast('已重新上锁');
                onClose();
              }}
            >
              立即上锁
            </button>
          )}
          {locked && (
            <button className="btn-ghost text-xs" onClick={() => void unlock()}>
              解锁
            </button>
          )}
          {!locked && keywords !== lockKeywords && !newPin && pinHash && (
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setLockKeywords(keywords.trim() || DEFAULT_LOCK_KEYWORDS);
                toast('关键字已保存', 'success');
              }}
            >
              保存关键字
            </button>
          )}
          <button className="btn-primary text-xs" disabled={!newPin} onClick={() => void savePin()}>
            {pinHash ? '修改 PIN' : '开启家长锁'}
          </button>
        </div>
      </div>
    </div>
  );
}
