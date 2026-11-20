import { useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Icon } from './Icons';
import { NearbyFoodPicker } from './NearbyFoodPicker';
import { COLORS } from './Wheel';
import { MAX_ITEMS } from '../lib/domain';

const EXAMPLE_ITEM = '番茄炒蛋';

interface Props {
  items: string[]; busy: boolean; sync?: ReactNode; onAdd: (input: string) => string;
  onAddNearby: (items: readonly string[]) => string; onRemove: (index: number) => void;
}
export function Menu({ items, busy, sync, onAdd, onAddNearby, onRemove }: Props) {
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const error = onAdd(input || EXAMPLE_ITEM);
    setFeedback(error);
    if (!error) setInput('');
    inputRef.current?.focus();
  }
  return <section className="panel menu-panel" aria-labelledby="menu-title">
    <div className="panel-heading">
      <h2 id="menu-title">我的候选菜单</h2>
      <div className="menu-heading-actions">
        <NearbyFoodPicker items={items} busy={busy} onAdd={onAddNearby} />
        <span className="count">{items.length} / {MAX_ITEMS}</span>
      </div>
    </div>
    <form className="add-form" onSubmit={submit}>
      <input ref={inputRef} aria-label="想吃什么" aria-describedby="menu-feedback" placeholder={`比如：${EXAMPLE_ITEM}`} autoComplete="off" maxLength={512} value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setFeedback(''); }} />
      <button className="add-button" disabled={busy} type="submit"><Icon name="plus" size={16} />添加</button>
    </form>
    <p className="form-feedback" id="menu-feedback" role="status">{feedback}</p>
    <div className="menu-items">
      {items.map((name, index) => (
        <span className="menu-chip" key={name} style={{ '--chip-color': COLORS[index] } as CSSProperties}>
          <i aria-hidden="true" />
          <span>{name}</span>
          <button type="button" disabled={busy} aria-label={`删除${name}`} onClick={() => {
            onRemove(index);
            setFeedback('');
          }}><Icon name="close" size={13} /></button>
        </span>
      ))}
      {!items.length && <div className="menu-empty"><Icon name="leaf" size={24} /><p>转盘空空的。<br />写下第一个想吃的吧。</p></div>}
    </div>
    {sync}
  </section>;
}
