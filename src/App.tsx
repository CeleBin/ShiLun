import { useEffect, useRef, useState } from 'react';
import { addItem, DEFAULT_ITEMS, defaultState, readState, saveState, targetRotation, uniformIndex, type HistoryEntry, type Recovery } from './lib/domain';
import { Icon } from './components/Icons';
import { Wheel } from './components/Wheel';
import { Menu } from './components/Menu';
import { History } from './components/History';
import { Videos } from './components/Videos';

function loadBrowser(): Recovery {
  try { return readState(window.localStorage); }
  catch { return { state: defaultState(), warning: '这个浏览器暂时无法记住选项，刷新后可能丢失；当前页面仍可使用。', canSave: false }; }
}

export default function App() {
  const [initial] = useState(loadBrowser);
  const [items, setItems] = useState(initial.state.items);
  const [history, setHistory] = useState<HistoryEntry[]>(initial.state.history);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [busy, setBusy] = useState(false);
  const [angle, setAngle] = useState(0);
  const [duration, setDuration] = useState(4200);
  const [result, setResult] = useState('');
  const [spinError, setSpinError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinning = useRef(false);

  useEffect(() => {
    if (!initial.canSave) return;
    let saved = false;
    try { saved = saveState(window.localStorage, { version: 1, items, history }); } catch { /* Getter itself may throw in privacy modes. */ }
    if (!saved) setStorageWarning('这个浏览器暂时无法记住选项，刷新后可能丢失；当前页面仍可使用。');
  }, [items, history, initial.canSave]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function resetResult() { setAngle(0); setResult(''); setSpinError(''); }
  function add(input: string) {
    if (spinning.current) return '转盘还在转，稍等一下。';
    const added = addItem(items, input);
    if (!added.ok) return added.error;
    setItems(added.items); resetResult();
    return '';
  }
  function spin() {
    if (spinning.current || !items.length) return;
    let index: number;
    try { index = uniformIndex(items.length); }
    catch { setSpinError('暂时无法开始抽选，请使用支持安全连接的浏览器重试。'); return; }
    const name = items[index];
    const nextAngle = targetRotation(index, items.length, angle);
    const time = matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 4200;
    spinning.current = true;
    setBusy(true); setDuration(time); setAngle(nextAngle); setResult(''); setSpinError('');
    timer.current = setTimeout(() => {
      setAngle(nextAngle % 360); setBusy(false); setResult(name);
      setHistory(previous => [{ name, at: Date.now() }, ...previous].slice(0, 8));
      spinning.current = false;
      timer.current = null;
    }, time + 50);
  }

  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header"><a className="brand" href="#" aria-label="ShiLun 首页"><span className="brand-icon"><Icon name="leaf" size={23} /></span><span>ShiLun<span className="brand-dot">.</span></span></a><span className="header-note">好好吃饭，是今天的小正事</span><a className="header-link" href="#videos">找点下饭的<Icon name="arrow" size={15} /></a></header>
    <main id="main">
      <section className="intro" aria-labelledby="page-title"><p className="eyebrow"><span /> A LITTLE SPIN, A HAPPY MEAL</p><h1 id="page-title">今天<span>吃什么</span>？</h1><p>把纠结交给转盘，把快乐留给餐桌。</p><div className="intro-doodle" aria-hidden="true"><svg viewBox="0 0 90 80"><path d="M15 37q30-34 52-6M60 18l9 14-17 3M30 50q15 22 37 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="m22 14 2-9 3 9 9 3-9 3-3 9-2-9-9-3Z" fill="currentColor" /></svg></div></section>
      <div className="decision-grid">
        <section className={`wheel-panel ${result ? 'has-result' : ''}`} aria-labelledby="wheel-heading">
          <div className="wheel-top"><h2 id="wheel-heading">STEP 01 · 下一顿，听它的</h2><span className="probability"><span />每一项 · 等概率</span></div>
          <Wheel items={items} angle={angle} busy={busy} duration={duration} />
          <p className="wheel-caption">{busy ? '转呀转，美味就要揭晓…' : result ? '少一点纠结，多一点好好吃饭。' : '小小转一下，结束“随便吃点”的一天。'}</p>
          <button className="spin-button" onClick={spin} disabled={busy || !items.length}>{busy ? '美味正在路上…' : !items.length ? '先添加想吃的吧' : result ? '再转一次，换个灵感' : '转一下，开饭！'}<Icon name="arrow" size={20} /></button>
          <div className="result" aria-live="polite" aria-atomic="true"><span>{busy ? '正在挑选' : result ? '就决定是你了' : '今天的美味'}</span><strong data-testid="spin-result">{busy ? '转呀转…' : result || '等待揭晓'}</strong>{result && <span className="result-spark" aria-hidden="true">✦</span>}</div>
          {spinError && <p className="spin-error" role="alert">{spinError}</p>}
        </section>
        <aside className="right-column"><Menu items={items} busy={busy} onAdd={add} onRemove={index => { if (spinning.current) return; setItems(items.filter((_, i) => i !== index)); resetResult(); }} onRestore={() => { if (spinning.current) return; setItems([...DEFAULT_ITEMS]); resetResult(); }} /><History entries={history} busy={busy} onClear={() => { if (!spinning.current) setHistory([]); }} /></aside>
      </div>
      {storageWarning && <p className="storage-warning" role="status"><Icon name="info" size={17} />{storageWarning}</p>}
      <Videos />
    </main>
    <footer className="site-footer"><a className="footer-brand" href="#">ShiLun.</a><p>一蔬一饭，好好生活。</p><span>吃饭这件小事，值得认真一点。<Icon name="leaf" size={15} /></span></footer>
  </>;
}
