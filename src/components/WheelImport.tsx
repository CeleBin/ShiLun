import { useState } from 'react';
import type { SavedState } from '../lib/domain';
import type { WheelData } from '../shared/contracts';
import { importWheel } from '../lib/cloudWheel';
import { AccountDialog, usePanelAction } from './AccountPanel';

export function WheelImport({ guest, cloud, save, onClose }: { guest: SavedState; cloud: WheelData; save: (draft: Pick<WheelData, 'items' | 'history'>) => Promise<unknown>; onClose: () => void }) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const all = [...new Set([...cloud.items, ...guest.items])];
  const [selected, setSelected] = useState(all);
  const { pending, run, notice } = usePanelAction();
  return <AccountDialog title="导入这个浏览器的选项" onClose={onClose}>
    <p className="account-description">只在你确认后写入当前账户。取消不会改变账户或本机内容。</p>
    <div className="import-preview"><section><h3>当前账户 · {cloud.items.length} 项</h3><p>{cloud.items.join('、') || '空菜单'}</p><small>{cloud.history.length} 条最近历史</small></section><section><h3>这个浏览器 · {guest.items.length} 项</h3><p>{guest.items.join('、') || '空菜单'}</p><small>{guest.history.length} 条最近历史</small></section></div>
    <fieldset disabled={pending} className="import-mode"><legend>如何导入</legend><label><input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />合并并去重</label><label><input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />用本机记录替换账户菜单和历史</label></fieldset>
    {mode === 'merge' && <fieldset disabled={pending} className="import-choice"><legend>保留哪些候选（{selected.length} / 16）</legend>{all.map(name => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={event => setSelected(event.target.checked ? [...selected, name] : selected.filter(item => item !== name))} />{name}</label>)}</fieldset>}
    {notice}<div className="account-actions"><button className="account-secondary" disabled={pending} onClick={onClose}>取消，保留账户内容</button><button className="account-primary" disabled={pending} onClick={() => void run(() => save(importWheel(guest, cloud, mode, mode === 'merge' ? selected : undefined)), '已导入账户。', onClose)}>确认导入并保存</button></div>
  </AccountDialog>;
}
