// Hand-curated metadata verified against Bilibili search/page records on 2026-11-11.
// Reasons are editorial suggestions, not summaries generated from watching the videos.
// Availability, membership requirements and metadata can change on the original platform.
export interface Video {
  id: string;
  url: string;
  title: string;
  author: string;
  reason: string;
  artwork: 'grill' | 'town' | 'pot' | 'bowl' | 'table' | 'steam';
  label: string;
  source: string;
  verifiedAt: string;
}

export const videos: Video[] = [
  {
    id: 'chuaner', url: 'https://www.bilibili.com/bangumi/play/ss24439',
    title: '人生一串', author: 'bilibili · 旗帜传媒',
    reason: '跟着街边的炭火和人情味，给这一顿饭添一点烟火气。',
    artwork: 'grill', label: '烟火人间',
    source: 'https://www.bilibili.com/bangumi/play/ss24439', verifiedAt: '2026-11-11',
  },
  {
    id: 'royal-kitchen', url: 'https://www.bilibili.com/video/BV1qE2MBKEDR',
    title: '足足20种料，做300年前的御膳！', author: '绵羊料理',
    reason: '吃一口自己的饭，再围观一场厨房里的大工程。',
    artwork: 'pot', label: '厨房奇遇',
    source: 'https://www.bilibili.com/video/BV1qE2MBKEDR/', verifiedAt: '2026-11-11',
  },
  {
    id: 'night-town', url: 'https://www.bilibili.com/bangumi/play/ss36310',
    title: '小城夜食记', author: '哔哩哔哩纪录片',
    reason: '把晚饭时间借给一座小城，听听食物背后的生活。',
    artwork: 'town', label: '一城一味',
    source: 'https://www.bilibili.com/bangumi/play/ss36310', verifiedAt: '2026-11-11',
  },
  {
    id: 'ancient-taste', url: 'https://www.bilibili.com/video/BV17FTtzkEsz',
    title: '你敢想吗！1000年前的老祖宗居然这么会吃！', author: '绵羊料理',
    reason: '想让这顿饭有点新鲜话题？去厨房里找找古人的灵感。',
    artwork: 'table', label: '古早好味',
    source: 'https://www.bilibili.com/video/BV17FTtzkEsz/', verifiedAt: '2026-11-11',
  },
  {
    id: 'three-months', url: 'https://www.bilibili.com/video/BV1PHmoBHExw',
    title: '足足等了3个月，终于吃上了！！', author: '绵羊料理',
    reason: '给愿意花时间做一顿饭的人，一点慢慢期待的快乐。',
    artwork: 'bowl', label: '慢慢做饭',
    source: 'https://www.bilibili.com/video/BV1PHmoBHExw/', verifiedAt: '2026-11-11',
  },
  {
    id: 'screen-taste', url: 'https://www.bilibili.com/video/BV17z4y167SS',
    title: '相信我，隔着屏幕你也会流口水...', author: '绵羊料理',
    reason: '一份轻松的厨房陪伴，适合和手边热乎乎的饭一起打开。',
    artwork: 'steam', label: '热气腾腾',
    source: 'https://www.bilibili.com/list/18202105?bvid=BV17z4y167SS&oid=586077847', verifiedAt: '2026-11-11',
  },
];
