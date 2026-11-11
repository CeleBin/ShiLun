import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icons';
import { COLORS } from './Wheel';
import { MAX_ITEMS } from '../lib/domain';

interface Props {
  items: string[]; busy: boolean; onAdd: (input: string) => string; onRemove: (index: number) => void; onRestore: () => void;
}
export function Menu({ items, busy, onAdd, onRemove, onRestore }: Props) {
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);
  useEffect(() => { if (busy) setConfirming(false); }, [busy]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const error = onAdd(input);
    setFeedback(error || '已加入转盘。');
    if (!error) setInput('');
    inputRef.current?.focus();
  }
  function cancel() { setConfirming(false); restoreRef.current?.focus(); }
  return <section className="panel menu-panel" aria-labelledby="menu-title">
    <div className="panel-heading"><h2 id="menu-title">我的候选菜单</h2><span className="count">{items.length} / {MAX_ITEMS}</span></div>
    <p className="panel-intro">想吃的加进来，不想吃的就划掉。</p>
    <form className="add-form" onSubmit={submit}>
      <input ref={inputRef} aria-label="想吃什么" aria-describedby="menu-feedback" placeholder="比如：番茄炒蛋" autoComplete="off" maxLength={512} value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setFeedback(''); }} />
      <button className="add-button" disabled={busy} type="submit"><Icon name="plus" size={16} />添加</button>
    </form>
    <p className="form-feedback" id="menu-feedback" role="status">{feedback}</p>
    <div className="menu-items">
      {items.map((name, index) => <span className="menu-chip" key={name}><i style={{ background: COLORS[index] }} aria-hidden="true" /><span>{name}</span><button type="button" disabled={busy} aria-label={`删除${name}`} onClick={() => { onRemove(index); setFeedback(`已移除${name}。`); }}><Icon name="close" size={13} /></button></span>)}
      {!items.length && <div className="menu-empty"><Icon name="leaf" size={24} /><p>转盘空空的。<br />写下第一个想吃的吧。</p></div>}
    </div>
    <div className="menu-bottom"><button ref={restoreRef} className="text-button" disabled={busy} onClick={() => setConfirming(true)}><Icon name="refresh" size={14} />恢复默认选项</button><span>最多 16 个 · 每个 16 字</span></div>
    {confirming && <div className="restore-confirm" role="group" aria-label="确认恢复默认选项" onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }}>
      <p>恢复后会替换现在的候选菜单，历史记录会保留。</p><div><button ref={cancelRef} className="small-button" onClick={cancel}>保留我的菜单</button><button className="small-button primary" onClick={() => { onRestore(); setConfirming(false); setFeedback('默认选项已恢复。'); restoreRef.current?.focus(); }}>确认恢复</button></div>
    </div>}
    <details className="storage-note"><summary><Icon name="check" size={13} />记住当前浏览器的选项<Icon name="info" size={13} /></summary><p>刷新或下次用同一设备、同一浏览器打开这个网站，选项还在。不跨设备同步，也不会额外生成文件；清除网站数据后会丢失，无痕窗口关闭后通常也会清除。浏览器禁止保存时，会显示提示。</p></details>
  </section>;
}
