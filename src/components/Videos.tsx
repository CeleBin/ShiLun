import { useState } from 'react';
import { videos } from '../data/videos';
import { isBilibiliUrl, nextBatch } from '../lib/domain';
import { Artwork } from './Artwork';
import { Icon } from './Icons';

const curated = videos.filter(video => isBilibiliUrl(video.url));
const BATCH_SIZE = 3;
export function Videos() {
  const [offset, setOffset] = useState(0);
  const [changed, setChanged] = useState(false);
  const visible = nextBatch(curated.length, offset, BATCH_SIZE).map(index => curated[index]);
  return <section className="videos-section" aria-labelledby="videos-title" id="videos">
    <div className="section-heading"><div><p className="section-kicker">STEP 02 · 给这一餐找个伴</p><h2 id="videos-title">饭有了，配点<span>好看的。</span></h2><p className="section-intro">几份私藏的下饭片单，慢慢吃，慢慢看。</p></div>{curated.length > BATCH_SIZE && <button className="batch-button" onClick={() => { setOffset((offset + BATCH_SIZE) % curated.length); setChanged(true); }}><Icon name="refresh" size={16} />换一批</button>}</div>
    <p className="sr-only" role="status">{changed ? '已换好新一批下饭视频。' : ''}</p>
    <div className="video-grid">
      {visible.map(video => <article className="video-card" key={video.id}>
        <a href={video.url} target="_blank" rel="noopener noreferrer" className="video-cover" tabIndex={-1} aria-hidden="true"><Artwork kind={video.artwork} /><span className="video-label">{video.label}</span><span className="cover-play"><Icon name="play" size={20} /></span><span className="art-credit">示意插画 · 非视频封面</span></a>
        <div className="video-body"><p className="video-source"><span className="bili-mark" aria-hidden="true">▥</span>BILIBILI<span className="source-line" />{video.author}</p><h3><a href={video.url} target="_blank" rel="noopener noreferrer">{video.title}<span className="sr-only">（在新标签页打开 B 站）</span></a></h3><p className="video-reason">{video.reason}</p><a className="video-link" href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`去 B 站看：${video.title}（新标签页）`}>去 B 站看看<Icon name="external" size={14} /></a></div>
      </article>)}
    </div>
    {!visible.length && <p className="empty-videos">片单正在整理，先转一转决定吃什么吧。</p>}
    <p className="video-footnote"><Icon name="info" size={13} />人工精选，只推荐链接。视频在原站观看，部分节目可能需要会员。</p>
  </section>;
}
