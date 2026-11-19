import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { DURATIONS, selectDurationPreferences, type Account, type Command, type Feedback } from '../shared/contracts';
import { durationLabel, VideoCover } from './VideoCover';
import { Icon } from './Icons';

export function AccountDialog({ title, onClose, children, compact = false }: { title: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    const cancel = (event: Event) => { event.preventDefault(); close.current(); };
    dialog?.addEventListener('cancel', cancel);
    return () => {
      dialog?.removeEventListener('cancel', cancel);
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog className={compact ? 'account-dialog account-dialog-compact' : 'account-dialog'} ref={ref} aria-labelledby={id}>
    <div className="account-heading"><div>{!compact && <p className="account-kicker">SHILUN · 我的下饭时光</p>}<h2 id={id}>{title}</h2></div><button type="button" className="account-close" onClick={onClose} aria-label="关闭窗口">×</button></div>
    {children}
  </dialog>;
}

export function SafeVideoLink({ url, children, className, title, showArrow = true }: { url: string; children: ReactNode; className?: string; title?: string; showArrow?: boolean }) {
  let safe = false;
  try { const parsed = new URL(url); safe = parsed.protocol === 'https:' && ['www.bilibili.com', 'bilibili.com'].includes(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port; } catch { /* Invalid persisted links are never clickable. */ }
  return safe
    ? <a href={url} className={className} title={title} target="_blank" rel="noopener noreferrer">{children}{showArrow && ' ↗'}</a>
    : <span className={className}>{children}{showArrow ? '（链接不可用）' : <span className="sr-only">（链接不可用）</span>}</span>;
}

export function usePanelAction() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const noticeVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function dismissNotice() {
    noticeVersion.current++;
    setNotice(null);
  }

  async function run(task: () => Promise<unknown>, success: string, after?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    dismissNotice();
    const version = noticeVersion.current;
    try {
      await task();
      if (!alive.current) return;
      after?.();
      if (noticeVersion.current === version) setNotice({ error: false, text: success });
    }
    catch (error) {
      if (alive.current && noticeVersion.current === version) {
        setNotice({ error: true, text: error instanceof Error ? error.message : '保存失败，请稍后重试。' });
      }
    }
    finally { lock.current = false; if (alive.current) setPending(false); }
  }
  return { pending, run, dismissNotice, notice: notice && <p className={`account-notice${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p> };
}

const date = (at: number) => new Date(at).toLocaleString('zh-CN');
const submissionStatus = { pending: '待审核', approved: '已收录', rejected: '未通过' };
const feedbackStatus = { open: '待处理', processing: '处理中', resolved: '已处理' };

function AccountVideoRow({ video, status, action, details }: {
  video: { url: string; title: string; author?: string; durationSeconds?: number; coverUrl?: string };
  status?: ReactNode;
  action: ReactNode;
  details?: ReactNode;
}) {
  const title = video.title || video.url || '视频资料暂不可用';
  const duration = durationLabel(video);
  return <li className="favorite-row">
    <SafeVideoLink url={video.url} title={title} className="favorite-video-link" showArrow={false}>
      <span className="favorite-cover">
        <VideoCover url={video.url} remoteCover={video.coverUrl} />
        {duration && <span className="video-duration">{duration}</span>}
      </span>
      <span className="favorite-video-copy">
        <strong>{title}</strong>
        {(video.author || video.url) && <span className="favorite-video-meta">{video.author || 'B 站'}</span>}
        {status}
      </span>
    </SafeVideoLink>
    {action}
    {details}
  </li>;
}

export default function AccountPanel({ account, command, onClose, initialTab = '收藏', initialVideoId = '' }: { account: Account; command: (command: Command) => Promise<unknown>; onClose: () => void; initialTab?: '收藏' | '投稿' | '反馈' | '偏好'; initialVideoId?: string }) {
  const [tab, setTab] = useState<string>(initialTab);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [addingFavorite, setAddingFavorite] = useState(false);
  const favoriteFormId = useId();
  const addFavoriteButton = useRef<HTMLButtonElement>(null);
  const [submitUrl, setSubmitUrl] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<Feedback['kind']>('建议');
  const [text, setText] = useState('');
  const [videoId, setVideoId] = useState(initialVideoId);
  const [preferences, setPreferences] = useState(() => selectDurationPreferences(account.preferences));
  const submitOperation = useRef('');
  const feedbackOperation = useRef('');
  const { pending, run, notice, dismissNotice } = usePanelAction();
  useEffect(() => { setPreferences(selectDurationPreferences(account.preferences)); }, [account.preferences]);
  const interests = Object.entries(account.interests);
  const interestVideos = new Map(account.interestVideos?.map(video => [video.id, video]));
  return <AccountDialog title="我的账户" onClose={onClose}>
    <nav className="account-tabs account-user-tabs" aria-label="账户栏目">{['收藏', '投稿', '偏好', '反馈'].map(name => <button key={name} type="button" aria-current={tab === name ? 'page' : undefined} onClick={() => {
      if (tab === name) return;
      dismissNotice();
      setTab(name);
    }}>{name}</button>)}</nav>
    {notice}
    <div aria-busy={pending} className="account-content">
      {tab === '收藏' && <section aria-label="我的收藏">
        <div className="favorite-toolbar">
          <h3>我的收藏 <span>{account.favorites.length}</span></h3>
          <button type="button" ref={addFavoriteButton} className="favorite-add" aria-expanded={addingFavorite} aria-controls={favoriteFormId} onClick={() => setAddingFavorite(open => !open)}>
            <Icon name={addingFavorite ? 'close' : 'plus'} size={15} />{addingFavorite ? '收起' : '添加收藏'}
          </button>
        </div>
        <form id={favoriteFormId} hidden={!addingFavorite} className="account-form favorite-form" onSubmit={event => {
          event.preventDefault();
          void run(() => command({ action: 'favorite', url: url.trim(), title: title.trim() }), '已保存到我的收藏。', () => {
            setUrl('');
            setTitle('');
            setAddingFavorite(false);
            addFavoriteButton.current?.focus();
          });
        }}>
          <fieldset disabled={pending}>
            <label>B 站完整链接<input type="url" required maxLength={500} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.bilibili.com/video/BV…" /></label>
            <label>标题或备注（选填）<input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
            <button type="submit" className="account-primary">{pending ? '正在保存…' : '添加到收藏'}</button>
          </fieldset>
        </form>
        {account.favorites.length ? (
          <ul className="favorite-list">
            {account.favorites.map(favorite => (
              <AccountVideoRow key={favorite.key} video={favorite}
                status={favorite.availability === 'unpublished' && <span className="favorite-video-meta">已退出公开推荐</span>}
                action={<button type="button" disabled={pending} className="favorite-remove" aria-label={`移除收藏：${favorite.title || favorite.url}`} onClick={() => void run(() => command({ action: 'favorite', url: favorite.url, remove: true }), '已移除收藏。')}>移除</button>}
              />
            ))}
          </ul>
        ) : <p className="account-empty">还没有收藏的视频。</p>}
      </section>}
      {tab === '投稿' && <section aria-label="我的投稿"><p className="account-description">分享适合下饭的视频，审核通过后会加入公共推荐。</p>
        <form className="account-form" onSubmit={event => { event.preventDefault(); submitOperation.current ||= crypto.randomUUID(); void run(() => command({ action: 'submit', url: submitUrl.trim(), reason: reason.trim(), operationId: submitOperation.current }), '投稿已提交，审核结果会显示在下方。', () => { setSubmitUrl(''); setReason(''); submitOperation.current = ''; }); }}>
          <fieldset disabled={pending}><label>B 站完整链接<input type="url" required maxLength={500} value={submitUrl} onChange={event => { setSubmitUrl(event.target.value); submitOperation.current = ''; }} /></label><label>为什么推荐它？<textarea required maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); submitOperation.current = ''; }} /></label><button className="account-primary">{pending ? '正在提交…' : '提交审核'}</button></fieldset>
        </form>
        {account.submissions.length ? <ul className="favorite-list">
          {account.submissions.map(item => {
            const videoCode = item.url.match(/\/(BV[A-Za-z0-9]{10}|(?:ss|ep)\d+)\/?$/)?.[1];
            return <AccountVideoRow key={item.id}
              video={{ url: item.url, ...item.video, title: item.video?.title || videoCode || 'B 站投稿视频' }}
              status={<span className="favorite-video-meta">{date(item.at)}</span>}
              action={<span className="account-badge">{submissionStatus[item.status]}</span>}
              details={<div className="submission-details">
                <p>{item.reason}</p>
                {item.reply && <p className="account-reply">审核回复：{item.reply}</p>}
              </div>}
            />;
          })}
        </ul> : <p className="account-empty">你的投稿记录会出现在这里。</p>}
      </section>}
      {tab === '反馈' && <section aria-label="我的反馈"><p className="account-description">遇到了问题，或有新的点子？处理进度和回复会留在这里。</p>
        <form className="account-form" onSubmit={event => { event.preventDefault(); feedbackOperation.current ||= crypto.randomUUID(); void run(() => command({ action: 'feedback', kind, text: text.trim(), videoId: videoId.trim() || undefined, operationId: feedbackOperation.current }), '反馈已提交。', () => { setText(''); setVideoId(''); feedbackOperation.current = ''; }); }}>
          <fieldset disabled={pending}><label>反馈类型<select value={kind} onChange={event => { setKind(event.target.value as Feedback['kind']); feedbackOperation.current = ''; }}>{(['问题', '建议', '功能', '视频失效'] as const).map(value => <option key={value}>{value}</option>)}</select></label><label>具体说明<textarea required maxLength={2000} value={text} onChange={event => { setText(event.target.value); feedbackOperation.current = ''; }} /></label><label>视频编号（选填）<input maxLength={120} value={videoId} onChange={event => { setVideoId(event.target.value); feedbackOperation.current = ''; }} placeholder="也可以把视频链接贴在具体说明里" /></label><button className="account-primary">{pending ? '正在提交…' : '发送反馈'}</button></fieldset>
        </form>
        <ul className="account-records">{account.feedback.map(item => <li key={item.id}><div className="account-record-head"><h3>{item.kind}</h3><span className="account-badge">{feedbackStatus[item.status]}</span></div><p>{item.text}</p>{item.videoId && <p className="account-meta">视频编号：{item.videoId}</p>}{item.reply && <p className="account-reply">处理回复：{item.reply}</p>}<p className="account-meta">{date(item.at)}</p></li>)}</ul>{!account.feedback.length && <p className="account-empty">暂时没有反馈记录。</p>}
      </section>}
      {tab === '偏好' && <section aria-label="推荐偏好">
        <form className="account-form" onSubmit={event => {
          event.preventDefault();
          void run(() => command({ action: 'preferences', tags: preferences }), '推荐偏好已保存。');
        }}>
          <fieldset disabled={pending}>
            <legend>视频时长（可多选）</legend>
            <div className="account-topics">
              {DURATIONS.map(tag => <label key={tag} className="account-topic">
                <input type="checkbox" checked={preferences.includes(tag)} onChange={event => {
                  const checked = event.target.checked;
                  setPreferences(current => checked ? [...current, tag] : current.filter(value => value !== tag));
                }} />{tag}
              </label>)}
            </div>
            <button className="account-primary">{pending ? '正在保存…' : '保存偏好'}</button>
          </fieldset>
        </form>
        <h3 className="account-subheading">我的兴趣标记</h3>
        {interests.length ? <ul className="favorite-list">
          {interests.map(([id, value]) => {
            const video = interestVideos.get(id);
            return <AccountVideoRow key={id} video={video ?? { url: '', title: '视频资料暂不可用' }}
              status={<span className="interest-video-status" data-interest={value}>{value === 'like' ? '喜欢' : '不感兴趣'}</span>}
              action={<button type="button" disabled={pending} className="favorite-remove" aria-label={`撤销兴趣标记：${video?.title || id}`} onClick={() => void run(() => command({ action: 'interest', videoId: id, value: null }), '已撤销兴趣标记。')}>撤销</button>}
            />;
          })}
        </ul> : <p className="account-empty">还没有兴趣标记。</p>}
      </section>}
    </div>
  </AccountDialog>;
}
