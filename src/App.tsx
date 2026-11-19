import { useEffect, useRef, useState } from 'react';
import { addItem, defaultState, readState, saveState, targetRotation, uniformIndex, type Recovery } from './lib/domain';
import { sameWheel } from './lib/cloudWheel';
import { ApiError } from './lib/api';
import { Icon } from './components/Icons';
import { Wheel } from './components/Wheel';
import { Menu } from './components/Menu';
import { History } from './components/History';
import { Videos } from './components/Videos';
import { useIdentity } from './auth/Identity';
import { useAccount } from './hooks/useAccount';
import AccountPanel from './components/AccountPanel';
import AdminPanel from './components/AdminPanel';
import AuthPanel from './components/AuthPanel';
import type { Account, Command, Draw, WheelData } from './shared/contracts';

const accountHashes = { 收藏: '#account', 投稿: '#submission', 反馈: '#feedback' } as const;
type AccountEntry = keyof typeof accountHashes;

function accountEntry(hash: string): AccountEntry | undefined {
  if (hash === accountHashes.投稿) return '投稿';
  if (hash === accountHashes.反馈 || hash.startsWith('#feedback?')) return '反馈';
  if (hash === accountHashes.收藏) return '收藏';
}

function loadBrowser(): Recovery {
  try { return readState(window.localStorage); }
  catch { return { state: defaultState(), warning: '这个浏览器暂时无法记住选项，刷新后可能丢失；当前页面仍可使用。', canSave: false }; }
}

export default function App() {
  const identity = useIdentity();
  // Identity-keyed remount also cancels old spins, pending panels and draft state.
  return <Experience key={identity.userId || 'guest'} />;
}
function Experience() {
  const identity = useIdentity();
  const cloud = useAccount(identity.userId, identity.getToken);
  const sendCommand = cloud.command;
  const [initial] = useState(loadBrowser);
  const [items, setItems] = useState<string[]>(identity.userId ? [] : initial.state.items);
  const [history, setHistory] = useState<Draw[]>(identity.userId ? [] : initial.state.history.map((entry, index) => ({ ...entry, id: `guest-${entry.at}-${index}` })));
  const [storageWarning, setStorageWarning] = useState(identity.userId ? '' : initial.warning);
  const [spinningNow, setSpinningNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncConflict, setSyncConflict] = useState(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const [base, setBase] = useState<WheelData | null>(null);
  const [notice, setNotice] = useState('');
  const [reportVideo, setReportVideo] = useState('');
  const [panel, setPanel] = useState<AccountEntry | 'admin' | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [angle, setAngle] = useState(0);
  const [duration, setDuration] = useState(4200);
  const [result, setResult] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinning = useRef(false);
  const initialized = useRef(false);
  const locked = !!identity.userId && !base;
  const busy = spinningNow || cloud.loading || locked || !identity.ready;
  const dirty = !!base && !sameWheel(base, { items, history });
  const showSync = locked || cloud.loading || !!syncError || !!cloud.error;

  function apply(value: WheelData) {
    setItems(value.items); setHistory(value.history); setBase(value); setAngle(0); setResult('');
  }
  useEffect(() => {
    if (cloud.account && !initialized.current) {
      initialized.current = true; apply(cloud.account.wheel);
      const hash = location.hash;
      const entry = accountEntry(hash);
      if (entry) {
        if (hash.startsWith('#feedback?')) setReportVideo(new URLSearchParams(hash.slice(10)).get('video') || '');
        setPanel(entry);
        historyReplace();
      }
    }
  }, [cloud.account]);
  useEffect(() => {
    if (identity.userId || !initial.canSave) return;
    let saved = false;
    try { saved = saveState(window.localStorage, { version: 1, items, history }); } catch { /* Privacy mode can reject the getter. */ }
    if (!saved) setStorageWarning('这个浏览器暂时无法记住选项，刷新后可能丢失；当前页面仍可使用。');
  }, [items, history, initial.canSave, identity.userId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!base || !dirty || saving || spinningNow || cloud.loading || cloud.error || syncError || syncConflict) return;
    setSaving(true);
    void sendCommand({ action: 'wheel', wheel: { items, history }, revision: base.revision })
      .then(response => {
        const updated = (response as Account).wheel;
        setBase(updated);
        // An older response must not replace edits made while it was saving.
        setHistory(current => current === history ? updated.history : current);
      })
      .catch(cause => {
        const message = cause instanceof Error ? cause.message : '保存失败，请稍后重试。';
        setSyncError(`尚未同步：${message} 当前更改仍保留在本页。`);
        setSyncConflict(cause instanceof ApiError && cause.code === 'CONFLICT');
      })
      .finally(() => setSaving(false));
  }, [base, dirty, items, history, saving, spinningNow, cloud.loading, cloud.error, syncError, syncConflict, sendCommand]);

  useEffect(() => {
    function dismissAccountMenu(event: PointerEvent) {
      const menu = accountMenu.current;
      if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
    }
    document.addEventListener('pointerdown', dismissAccountMenu);
    return () => document.removeEventListener('pointerdown', dismissAccountMenu);
  }, []);

  function closeAccountMenu() {
    const menu = accountMenu.current;
    if (!menu) return;
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }

  function resetResult() { setAngle(0); setResult(''); setNotice(''); }
  function addMany(inputs: readonly string[]) {
    if (spinning.current || busy) return '请稍等当前操作完成。';
    let next = items;
    for (const input of inputs) {
      const added = addItem(next, input);
      if (!added.ok) return added.error;
      next = added.items;
    }
    setItems(next); resetResult(); return '';
  }
  function spin() {
    if (spinning.current || busy || !items.length) return;
    let index: number;
    let nextAngle: number;
    try {
      index = uniformIndex(items.length);
      nextAngle = targetRotation(index, items.length, angle);
    }
    catch { setNotice('暂时无法开始抽选，请使用支持安全连接的浏览器重试。'); return; }
    const name = items[index];
    const draw: Draw = { id: crypto.randomUUID(), name, at: Date.now(), items: [...items] };
    const time = matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 4200;
    spinning.current = true;
    setSpinningNow(true); setDuration(time); setAngle(nextAngle); setResult(''); setNotice('');
    timer.current = setTimeout(() => {
      const updatedHistory = [draw, ...history].slice(0, 8);
      setAngle(nextAngle % 360); setSpinningNow(false); setResult(name); setHistory(updatedHistory);
      spinning.current = false; timer.current = null;
    }, time + 50);
  }
  function askLogin() {
    if (!identity.configured) { setNotice('账号功能尚未开通，当前可继续使用转盘和精选片单。'); return; }
    setAuthOpen(true);
  }
  function historyReplace() { window.history.replaceState(null, '', location.pathname + location.search); }
  function openAccount(entry: AccountEntry = '收藏') {
    setReportVideo('');
    if (identity.userId) {
      setPanel(entry);
      if (cloud.error && !cloud.account) setNotice('账户内容暂未加载，请点击重新读取。');
      return;
    }
    if (identity.configured) window.history.replaceState(null, '', accountHashes[entry]);
    askLogin();
  }
  async function reloadWheel() {
    if (dirty && !window.confirm('重新读取会放弃本页尚未同步的转盘更改，继续吗？')) return;
    setSyncError('');
    const value = await cloud.reload();
    if (value) { apply(value.wheel); setSyncConflict(false); }
  }
  async function accountCommand(input: Command) {
    const value = await cloud.command(input);
    if (input.action === 'deleteAccountData' && value && typeof value === 'object' && 'userId' in value) { apply((value as Account).wheel); setNotice('账户内的个人数据已清除。'); }
    return value;
  }
  const openAdmin = async () => {
    try { await cloud.loadAdmin(); setPanel('admin'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : '管理内容读取失败。'); }
  };

  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header">
      <a className="brand" href="#" aria-label="ShiLun 首页">
        <span className="brand-icon brand-wheel"><img className="brand-wheel-face" src="/favicon.svg?v=2" alt="" /></span>
        <span>ShiLun<span className="brand-dot">.</span></span>
      </a>
      <nav className="header-account" aria-label="用户账户">
        {identity.userId ? (
          <details className="header-account-menu" ref={accountMenu} onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) closeAccountMenu();
          }}>
            <summary>我的账号</summary>
            <div className="header-account-options">
              <p className="account-identifier">{identity.displayName}</p>
              <button type="button" onClick={() => { closeAccountMenu(); openAccount(); }}>个人中心</button>
              {cloud.account?.isAdmin && <button type="button" onClick={() => { closeAccountMenu(); void openAdmin(); }}>内容管理</button>}
              <button type="button" onClick={() => {
                closeAccountMenu();
                void identity.logout().catch(() => setNotice('退出暂未成功，请重试。'));
              }}>退出登录</button>
            </div>
          </details>
        ) : <button disabled={!identity.ready} onClick={askLogin}>登录 / 注册</button>}
      </nav>
    </header>
    <main id="main">
      <section className="intro" aria-labelledby="page-title">
        <h1 id="page-title">{identity.userId && identity.username && <bdi className="intro-greeting">Hello {identity.username}，</bdi>}今天<span>吃什么</span>？</h1>
      </section>
      <div className="decision-grid">
        <section className="wheel-panel" aria-label="转盘抽选">
          <Wheel items={items} angle={angle} busy={spinningNow} duration={duration} />
          <div className="wheel-actions">
            <div className="sr-only" aria-live="polite" aria-atomic="true">{result ? `抽到：${result}` : ''}</div>
            <button className={`spin-button${result ? ' spin-button-result' : ''}`} onClick={spin}
              disabled={busy || !items.length} aria-label={result ? '再转一次' : undefined}>
              {result ? (
                <>
                  <span className="spin-result-copy">
                    <span className="spin-result-prefix">这顿就吃</span>
                    <strong className="spin-result-name" data-testid="spin-result">{result}</strong>
                  </span>
                  <span className="spin-result-action">再转一次<Icon name="refresh" size={15} /></span>
                </>
              ) : (
                <>
                  {spinningNow ? '正在抽选…' : !items.length ? '先添加想吃的吧' : '转一下，开饭！'}
                  <Icon name="arrow" size={20} />
                </>
              )}
            </button>
          </div>
        </section>
        <aside className="right-column">
          <Menu items={items} busy={busy} onAdd={input => addMany([input])} onAddNearby={addMany}
            onRemove={index => {
              if (spinning.current || busy) return;
              setItems(items.filter((_, i) => i !== index));
              resetResult();
            }}
            sync={identity.userId && showSync ? (
              <div className="menu-sync" aria-label="账户转盘同步">
                <div className="menu-sync-row">
                  <span className="menu-sync-status" role="status" data-dirty={dirty}>
                    <Icon name={syncError || cloud.error ? 'info' : 'refresh'} size={14} />
                    {syncError || cloud.error ? '同步遇到问题' : '正在读取…'}
                  </span>
                  {syncError && !syncConflict && !cloud.error && <button type="button" className="small-button" onClick={() => setSyncError('')}>重试同步</button>}
                  {(cloud.error || syncConflict) && <button type="button" className="small-button" disabled={spinningNow || saving || cloud.loading} onClick={() => void reloadWheel()}>重新读取</button>}
                </div>
                {(syncError || cloud.error) && <p className="menu-sync-error" role="status">{syncError || cloud.error}</p>}
              </div>
            ) : null}
          />
          <History entries={history} busy={busy} onClear={() => {
            if (!spinning.current && !busy) { setHistory([]); setNotice(''); }
          }} />
        </aside>
      </div>
      {storageWarning && <p className="storage-warning" role="status"><Icon name="info" size={17} />{storageWarning}</p>}
      {notice && <p className="storage-warning" role="status">{notice}</p>}
      <Videos account={cloud.account} getToken={identity.getToken} command={cloud.command} onLogin={askLogin} onAccount={openAccount} onSubmitVideo={() => openAccount('投稿')} />
    </main>
    <footer className="site-footer">
      <a className="footer-brand" href="#">ShiLun.</a>
      <p>一蔬一饭，好好生活。</p>
      <button type="button" className="text-button footer-feedback" onClick={() => openAccount('反馈')}>意见反馈</button>
    </footer>
    {panel && panel !== 'admin' && cloud.account && <AccountPanel initialTab={panel} initialVideoId={reportVideo} account={cloud.account} command={accountCommand} onClose={() => setPanel(null)} />}
    {panel === 'admin' && cloud.admin && <AdminPanel data={cloud.admin} command={cloud.command} reload={cloud.loadAdmin} onClose={() => setPanel(null)} />}
    {authOpen && <AuthPanel onClose={() => {
      if (accountEntry(location.hash)) historyReplace();
      setAuthOpen(false);
    }} onSuccess={async () => { await identity.refresh(); setAuthOpen(false); }} />}
  </>;
}
