'use client';

import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useT } from '@/lib/i18n';

function Key({ children }: { children: React.ReactNode }) {
  return <code className="text-accent">{children}</code>;
}

export default function AboutPage() {
  const t = useT();
  return (
    <div className="min-h-screen flex flex-col pb-tabbar">
      <Header />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-xl font-bold text-content mb-3">{t('关于 IPTV Plus', 'About IPTV Plus')}</h1>
          <p className="text-sm text-muted leading-relaxed">
            {t('IPTV Plus 基于开源项目', 'IPTV Plus is built on the open-source project')}{' '}
            <a className="text-accent hover:underline" href="https://github.com/LibreSpark/LibreTV" target="_blank" rel="noopener noreferrer">
              LibreTV
            </a>{' '}
            {t(
              '（AGPL-3.0）修改而来：在其点播聚合搜索与直播能力之上，增加了 Xtream Codes 账号、频道回看、节目表网格、多屏同看、节目预约提醒、家长锁、睡眠定时与数字键换台等功能。无需注册、无内嵌广告、不存储任何视频文件，所有播放内容均来自第三方公开接口。',
              '(AGPL-3.0). On top of its multi-source video search and live TV, it adds Xtream Codes accounts, catch-up, a TV guide grid, multi-view, programme reminders, a parental lock, a sleep timer and number-key channel changing. No sign-up, no ads, and no video files are stored — everything plays from third-party sources you add.'
            )}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">{t('直播快捷键', 'Live TV shortcuts')}</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><Key>↑</Key> / <Key>↓</Key> {t('上一台 / 下一台', 'channel up / down')}</li>
            <li><Key>0</Key>–<Key>9</Key> {t('输入频道号换台', 'type a channel number')}</li>
            <li><Key>Backspace</Key> {t('回到上一个频道', 'back to the previous channel')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">{t('电影剧集快捷键', 'Movie player shortcuts')}</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><Key>{t('空格', 'Space')}</Key> {t('播放 / 暂停', 'play / pause')}</li>
            <li><Key>←</Key> / <Key>→</Key> {t('快退 / 快进 5 秒', 'back / forward 5 s')}</li>
            <li><Key>↑</Key> / <Key>↓</Key> {t('音量调节', 'volume')}</li>
            <li><Key>F</Key> {t('切换全屏', 'fullscreen')}</li>
            <li><Key>Alt + ←/→</Key> {t('上一集 / 下一集', 'previous / next episode')}</li>
            <li>{t('移动端长按视频可 3 倍速播放', 'On phones, press and hold the video for 3× speed')}</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">{t('电视遥控器', 'TV remote')}</h2>
          <p className="text-sm text-muted leading-relaxed">
            {t(
              '在首页与电影剧集页，用方向键移动选择、确认键打开；直播页的上下键直接换台。',
              'On Home and Movies & Shows, use the arrow keys to move and OK to open. On Live TV, up/down changes the channel.'
            )}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">{t('隐私与数据', 'Privacy & data')}</h2>
          <p className="text-sm text-muted leading-relaxed">
            {t(
              '你的搜索历史、观看进度等数据仅保存在本设备浏览器中（IndexedDB），不会上传到服务器。聚合搜索请求由服务端代理转发，第三方数据源不会看到你的 IP 地址。',
              'Your search history and watch progress stay in this browser (IndexedDB) and are never uploaded. Searches go through the server, so third-party sources do not see your IP address.'
            )}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">{t('免责声明', 'Disclaimer')}</h2>
          <p className="text-sm text-faint leading-relaxed">
            {t(
              '本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。请尊重版权，所有内容的合法性由对应数据源负责。',
              'This project does not store or produce any video content; it only searches and plays third-party sources. Please respect copyright — each source is responsible for the legality of its content.'
            )}
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
