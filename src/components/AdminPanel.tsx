import { useRef, useState } from 'react';
import { PREFERENCE_OPTIONS, type AdminData, type CatalogVideo, type Command, type Feedback, type Submission } from '../shared/contracts';
import { AccountDialog, SafeVideoLink, usePanelAction } from './AccountPanel';

type Metadata = { title: string; author: string; reason: string; tags: string[] };
const emptyMetadata = (): Metadata => ({ title: '', author: '', reason: '', tags: [] });
function MetadataFields({ value, setValue }: { value: Metadata; setValue: (value: Metadata) => void }) {
  return <><label>视频标题<input required maxLength={160} value={value.title} onChange={event => setValue({ ...value, title: event.target.value })} /></label><label>原作者 / 来源<input required maxLength={120} value={value.author} onChange={event => setValue({ ...value, author: event.target.value })} /></label><label>公开推荐理由<textarea required maxLength={1000} value={value.reason} onChange={event => setValue({ ...value, reason: event.target.value })} /></label><label>标签（以逗号分隔，至少一个）<input required maxLength={240} value={value.tags.join(',')} onChange={event => setValue({ ...value, tags: event.target.value.split(/[,，]/) })} placeholder={PREFERENCE_OPTIONS.slice(0, 5).join('、')} /></label><p className="account-meta">仅填写已核实的主题、风格或时长，不根据标题猜测视频时长。</p></>;
}
function cleaned(value: Metadata): Metadata { return { title: value.title.trim(), author: value.author.trim(), reason: value.reason.trim(), tags: [...new Set(value.tags.map(tag => tag.trim()).filter(Boolean))] }; }
type Action = (command: Command) => Promise<unknown>;
function ReviewCard({ item, command, disabled }: { item: Submission; command: Action; disabled: boolean }) {
  const [video, setVideo] = useState(emptyMetadata);
  const [reply, setReply] = useState('');
  const { pending, run, notice } = usePanelAction();
  return <article className="account-admin-card"><div className="account-record-head"><h3><SafeVideoLink url={item.url}>{item.url}</SafeVideoLink></h3><span className="account-badge">待审核</span></div><p>{item.reason}</p><p className="account-meta">投稿人：{item.userId} · {new Date(item.at).toLocaleString('zh-CN')}</p>
    <form className="account-form" onSubmit={event => { event.preventDefault(); void run(() => command({ action: 'review', id: item.id, decision: 'approved', reply: reply.trim(), video: cleaned(video) }), '已审核通过并收录。'); }}><fieldset disabled={pending || disabled}><MetadataFields value={video} setValue={setVideo} /><label>给投稿人的回复 / 拒绝原因<textarea required maxLength={1000} value={reply} onChange={event => setReply(event.target.value)} /></label><div className="account-actions"><button className="account-primary">审核通过并发布</button><button className="account-danger" type="button" disabled={!reply.trim()} onClick={() => void run(() => command({ action: 'review', id: item.id, decision: 'rejected', reply: reply.trim() }), '已拒绝投稿并保存回复。')}>拒绝投稿</button></div></fieldset></form>{notice}
  </article>;
}
function CatalogCard({ item, command, disabled }: { item: CatalogVideo; command: Action; disabled: boolean }) {
  const [video, setVideo] = useState<Metadata>({ title: item.title, author: item.author, reason: item.reason, tags: item.tags });
  const [published, setPublished] = useState(item.published);
  const { pending, run, notice } = usePanelAction();
  return <details className="account-admin-card"><summary><span>{item.title}</span><span className="account-badge">{item.published ? '已发布' : '已下架'}</span></summary><p className="account-meta"><SafeVideoLink url={item.url}>原站核对</SafeVideoLink> · 视频编号：{item.id}</p><form className="account-form" onSubmit={event => { event.preventDefault(); void run(() => command({ action: 'video', id: item.id, revision: item.revision ?? 0, published, ...cleaned(video) }), '视频信息已保存。'); }}><fieldset disabled={pending || disabled}><MetadataFields value={video} setValue={setVideo} /><label className="account-topic"><input type="checkbox" checked={published} onChange={event => setPublished(event.target.checked)} />公开发布（取消后不再进入新推荐）</label><button className="account-primary">保存视频信息</button></fieldset></form>{notice}</details>;
}
function FeedbackCard({ item, command, disabled }: { item: Feedback; command: Action; disabled: boolean }) {
  const [status, setStatus] = useState(item.status);
  const [reply, setReply] = useState(item.reply);
  const { pending, run, notice } = usePanelAction();
  return <article className="account-admin-card"><h3>{item.kind}</h3><p>{item.text}</p><p className="account-meta">用户：{item.userId} · {new Date(item.at).toLocaleString('zh-CN')}{item.videoId && ` · 视频编号：${item.videoId}`}</p><form className="account-form" onSubmit={event => { event.preventDefault(); void run(() => command({ action: 'handleFeedback', id: item.id, status, reply: reply.trim() }), '处理状态与回复已保存。'); }}><fieldset disabled={pending || disabled}><label>处理状态<select value={status} onChange={event => setStatus(event.target.value as Feedback['status'])}><option value="open">待处理</option><option value="processing">处理中</option><option value="resolved">已处理</option></select></label><label>用户可见的回复<textarea required maxLength={2000} value={reply} onChange={event => setReply(event.target.value)} /></label><button className="account-primary">保存处理结果</button></fieldset></form>{notice}</article>;
}

export default function AdminPanel({ data, command, reload, onClose }: { data: AdminData; command: Action; reload: () => Promise<void>; onClose: () => void }) {
  const [tab, setTab] = useState('审核');
  const [video, setVideo] = useState(emptyMetadata);
  const [url, setUrl] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const operation = useRef('');
  const { pending, run, notice } = usePanelAction();
  const queue = data.submissions.filter(item => item.status === 'pending');
  const filteredFeedback = data.feedback.filter(item => (!userFilter || item.userId.includes(userFilter)) && (!kindFilter || item.kind === kindFilter) && (!statusFilter || item.status === statusFilter));
  return <AccountDialog title="内容管理" onClose={onClose}><div className="account-toolbar"><nav className="account-tabs" aria-label="管理栏目">{['审核', '视频库', '反馈'].map(name => <button type="button" key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{name}{name === '审核' ? ` (${queue.length})` : ''}</button>)}</nav><button type="button" className="account-text-button" disabled={pending} onClick={() => void run(reload, '管理数据已刷新。')}>刷新</button></div>{notice}<div className="account-content" aria-busy={pending}>
    {tab === '审核' && <section aria-label="投稿审核"><p className="account-description">请在原站核对标题、原作者与内容，再填写标签和公开推荐理由。</p>{queue.map(item => <ReviewCard key={item.id} item={item} command={command} disabled={pending} />)}{!queue.length && <p className="account-empty">没有待审核的投稿。</p>}<h3 className="account-subheading">已处理投稿</h3><ul className="account-records">{data.submissions.filter(item => item.status !== 'pending').map(item => <li key={item.id}><div className="account-record-head"><SafeVideoLink url={item.url}>{item.url}</SafeVideoLink><span className="account-badge">{item.status === 'approved' ? '已收录' : '未通过'}</span></div><p>{item.reply}</p><p className="account-meta">投稿人：{item.userId}{item.reviewedBy && ` · 审核人：${item.reviewedBy}`}{item.reviewedAt && ` · ${new Date(item.reviewedAt).toLocaleString('zh-CN')}`}</p></li>)}</ul></section>}
    {tab === '视频库' && <section aria-label="视频库"><details className="account-admin-card"><summary>录入一条精选视频</summary><form className="account-form" onSubmit={event => { event.preventDefault(); operation.current ||= crypto.randomUUID(); void run(() => command({ action: 'createVideo', url: url.trim(), ...cleaned(video), operationId: operation.current }), '精选视频已录入并发布。', () => { setUrl(''); setVideo(emptyMetadata()); operation.current = ''; }); }}><fieldset disabled={pending}><label>B 站完整链接<input type="url" required maxLength={500} value={url} onChange={event => { setUrl(event.target.value); operation.current = ''; }} /></label><MetadataFields value={video} setValue={value => { setVideo(value); operation.current = ''; }} /><button className="account-primary">录入并发布</button></fieldset></form></details>{data.videos.map(item => <CatalogCard key={`${item.id}:${item.revision ?? 0}`} item={item} command={command} disabled={pending} />)}</section>}
    {tab === '反馈' && <section aria-label="反馈处理"><div className="account-filters"><label>用户编号<input value={userFilter} onChange={event => setUserFilter(event.target.value)} /></label><label>类型<select value={kindFilter} onChange={event => setKindFilter(event.target.value)}><option value="">全部类型</option>{['问题', '建议', '功能', '视频失效'].map(kind => <option key={kind}>{kind}</option>)}</select></label><label>状态<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="open">待处理</option><option value="processing">处理中</option><option value="resolved">已处理</option></select></label></div>{filteredFeedback.map(item => <FeedbackCard key={`${item.id}:${item.status}:${item.reply}`} item={item} command={command} disabled={pending} />)}{!filteredFeedback.length && <p className="account-empty">没有符合条件的反馈。</p>}</section>}
  </div></AccountDialog>;
}
