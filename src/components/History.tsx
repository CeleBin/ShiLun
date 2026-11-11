import { Icon } from './Icons';
import type { HistoryEntry } from '../lib/domain';

export function History({ entries, busy, onClear }: { entries: HistoryEntry[]; busy: boolean; onClear: () => void }) {
  return <section className="panel history-panel" aria-labelledby="history-title">
    <div className="panel-heading"><h2 id="history-title"><Icon name="clock" size={17} />最近转到了</h2><button className="text-button" disabled={!entries.length || busy} onClick={onClear}>清空记录</button></div>
    {entries.length ? <ol className="history-list">{entries.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="history-index">{String(index + 1).padStart(2, '0')}</span><span className="history-name">{entry.name}</span><time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString('zh-CN')}>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol> : <p className="history-empty">还没开转，第一顿美味等你揭晓。</p>}
  </section>;
}
