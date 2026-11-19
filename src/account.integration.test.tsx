// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { IdentityContext, type Identity } from './auth/Identity';
import { videos } from './data/videos';
import { RECOMMENDATION_BATCH_SIZE, type Account, type Command } from './shared/contracts';

const KEY = 'shilun.wheel.v1';
const makeAccount = (userId: string): Account => ({ userId, wheel: { items: [`${userId}的面`], history: [], revision: 0 }, favorites: [], preferences: [], interests: {}, submissions: [], feedback: [], isAdmin: false });
const profile = (id: string | null): Identity => ({ userId: id, ready: true, configured: true, displayName: id || '', getToken: async () => id ? `token-${id}` : null, login: vi.fn(), logout: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined) });
const result = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let accounts: Record<string, Account>;
let commands: Command[];
let denyWheel = false;
let wheelWriteGate: Promise<void> | undefined;
let videoWriteGate: Promise<boolean> | undefined;
let recommendationSource = videos;
let nearbySearchFails = false;

beforeEach(() => {
  localStorage.clear(); accounts = { A: makeAccount('A'), B: makeAccount('B') }; commands = []; denyWheel = false; videoWriteGate = undefined; wheelWriteGate = undefined; recommendationSource = videos; nearbySearchFails = false;
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/nearby') return nearbySearchFails
      ? result({ error: '附近餐饮暂时查不到。' }, 503)
      : result({ categories: ['面馆', '火锅'], stores: [{ name: '兰州拉面（东门店）', distance: 200, category: '面馆' }] });
    const id = (init?.headers as Record<string, string> | undefined)?.Authorization?.replace('Bearer token-', '');
    const account = id ? accounts[id] : undefined;
    if (init?.method !== 'POST') {
      if (parsed.searchParams.get('action') === 'recommendations') {
        const exclude = (parsed.searchParams.get('exclude') ?? '').split(',').filter(Boolean);
        const batch = recommendationSource.filter(video => !exclude.includes(video.id)).slice(0, RECOMMENDATION_BATCH_SIZE);
        return result({ videos: batch.map(video => ({ ...video, tags: ['美食'], published: true, recommendationReason: '精选' })), requestId: exclude.length ? 'request-next' : 'request-test', strategy: 'test', hasMore: recommendationSource.length > batch.length });
      }
      return account ? result(account) : result({ error: '请登录' }, 401);
    }
    const command: Command = JSON.parse(init.body as string); commands.push(command);
    if (!account) return result({ error: '请登录' }, 401);
    if (command.action === 'event') return result({ ok: true });
    if ((command.action === 'favorite' || command.action === 'interest') && videoWriteGate && !(await videoWriteGate)) return result({ error: '保存失败，请重试。' }, 503);
    if (command.action === 'favorite') {
      account.favorites = account.favorites.filter(item => item.url !== command.url);
      if (!command.remove) account.favorites.push({ key: command.url, url: command.url, title: command.title || command.url, at: Date.now() });
    } else if (command.action === 'wheel') {
      await wheelWriteGate;
      if (denyWheel || command.revision !== account.wheel.revision) return result({ error: '另一设备已修改，请重新读取。', code: 'CONFLICT' }, 409);
      account.wheel = { ...command.wheel, revision: account.wheel.revision + 1 };
    } else if (command.action === 'submit') account.submissions.push({ id: 'submission-test', userId: account.userId, url: command.url, reason: command.reason, status: 'pending', reply: '', at: Date.now() });
    else if (command.action === 'feedback') account.feedback.push({ id: 'feedback-test', userId: account.userId, kind: command.kind, text: command.text, videoId: command.videoId, status: 'open', reply: '', at: Date.now() });
    else if (command.action === 'preferences') {
      account.preferences = command.tags;
      return result({ preferences: account.preferences });
    }
    else if (command.action === 'interest') { if (command.value) account.interests[command.videoId] = command.value; else delete account.interests[command.videoId]; }
    else if (command.action === 'deleteAccountData') { accounts[id!] = makeAccount(id!); accounts[id!].wheel.revision = account.wheel.revision + 1; return result(accounts[id!]); }
    return result(account);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function loaded() { await screen.findByRole('button', { name: '删除A的面' }); }
const mount = (identity: Identity) => render(<IdentityContext.Provider value={identity}><App /></IdentityContext.Provider>);

it('caches nearby categories, stores and selections across page loads and only refreshes on request', async () => {
  const user = userEvent.setup();
  const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { longitude: 116.391, latitude: 39.907 } } as GeolocationPosition));
  const testNavigator = Object.create(navigator);
  Object.defineProperty(testNavigator, 'geolocation', { value: { getCurrentPosition } });
  vi.stubGlobal('navigator', testNavigator);
  const page = mount(profile(null));
  expect(getCurrentPosition).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '从附近选' }));
  const dialog = within(await screen.findByRole('dialog', { name: '附近吃什么' }));
  await user.click(await dialog.findByRole('checkbox', { name: '面馆' }));
  expect(dialog.queryByRole('checkbox', { name: /兰州拉面（东门店）/ })).toBeNull();
  const expand = dialog.getByRole('button', { name: '展开面馆店铺' });
  await user.click(expand);
  expect((dialog.getByRole('checkbox', { name: /兰州拉面（东门店）/ }) as HTMLInputElement).checked).toBe(false);
  await user.click(dialog.getByRole('checkbox', { name: /兰州拉面（东门店）/ }));
  await user.click(dialog.getByRole('button', { name: '折叠面馆店铺' }));
  expect(dialog.queryByRole('checkbox', { name: /兰州拉面（东门店）/ })).toBeNull();
  await user.click(dialog.getByRole('button', { name: '关闭窗口' }));
  page.unmount();
  mount(profile(null));
  await user.click(screen.getByRole('button', { name: '从附近选' }));
  const reopened = within(screen.getByRole('dialog', { name: '附近吃什么' }));
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  expect((reopened.getByRole('checkbox', { name: '面馆' }) as HTMLInputElement).checked).toBe(true);
  await user.click(reopened.getByRole('button', { name: '展开面馆店铺' }));
  expect((reopened.getByRole('checkbox', { name: /兰州拉面（东门店）/ }) as HTMLInputElement).checked).toBe(true);

  nearbySearchFails = true;
  await user.click(reopened.getByRole('button', { name: '刷新附近店铺' }));
  await reopened.findByRole('alert');
  expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  await user.click(reopened.getByRole('button', { name: '加入转盘' }));
  expect(screen.getByRole('button', { name: '删除面馆' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '删除兰州拉面（东门店）' })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(KEY)!).items).toEqual(expect.arrayContaining(['面馆', '兰州拉面（东门店）']));
});

it('groups older cached stores without searching again', async () => {
  localStorage.setItem('shilun.nearby.v1', JSON.stringify({
    results: {
      categories: ['面馆'],
      stores: [{ name: '兰州拉面（东门店）', distance: 200 }, { name: '如意餐厅', distance: 300 }],
    },
    checked: ['如意餐厅'],
  }));
  const user = userEvent.setup();
  mount(profile(null));
  await user.click(screen.getByRole('button', { name: '从附近选' }));
  const dialog = within(screen.getByRole('dialog', { name: '附近吃什么' }));
  await user.click(dialog.getByRole('button', { name: '展开其他餐饮店铺' }));
  expect((dialog.getByRole('checkbox', { name: /如意餐厅/ }) as HTMLInputElement).checked).toBe(true);
  expect(dialog.getByRole('button', { name: '展开面馆店铺' })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/nearby')).toBe(false);
});

it('filters cached store names, keeps other dining last and shows hidden selections', async () => {
  localStorage.setItem('shilun.nearby.v1', JSON.stringify({
    results: {
      categories: ['其他餐饮', '面馆', '火锅'],
      stores: [
        { name: '兰州拉面（东门店）', distance: 200, category: '面馆' },
        { name: '重庆小面', distance: 220, category: '面馆' },
        { name: 'Neo 火锅', distance: 300, category: '火锅' },
        { name: '长安小馆', distance: 330, category: '其他餐饮' },
      ],
    },
    checked: ['重庆小面'],
  }));
  const user = userEvent.setup();
  mount(profile(null));
  await user.click(screen.getByRole('button', { name: '从附近选' }));
  const dialog = within(screen.getByRole('dialog', { name: '附近吃什么' }));
  expect(dialog.getAllByRole('checkbox').map(box => box.closest('label')?.textContent))
    .toEqual(['面馆', '火锅', '其他餐饮']);
  const input = dialog.getByRole('searchbox', { name: '筛选店名' });
  await user.type(input, '东门');
  expect(dialog.getByRole('checkbox', { name: /兰州拉面/ })).toBeTruthy();
  expect(dialog.queryByRole('checkbox', { name: /重庆小面|火锅/ })).toBeNull();
  expect(dialog.getByText('已选 1 家')).toBeTruthy();
  expect(dialog.getByText('已选 1 项 · 还可加 7 项')).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: '折叠面馆店铺' }));
  expect(dialog.queryByRole('checkbox', { name: /兰州拉面/ })).toBeNull();
  expect(dialog.getByText('已选 1 家')).toBeTruthy();

  await user.clear(input);
  await user.type(input, 'nEO');
  expect(dialog.getByRole('checkbox', { name: /Neo 火锅/ })).toBeTruthy();
  expect(dialog.queryByRole('checkbox', { name: '面馆' })).toBeNull();
  await user.clear(input);
  await user.type(input, '面馆');
  expect(dialog.getByText('没有店名包含这个关键词。')).toBeTruthy();
  await user.clear(input);
  await user.click(dialog.getByRole('button', { name: '展开面馆店铺' }));
  expect((dialog.getByRole('checkbox', { name: /重庆小面/ }) as HTMLInputElement).checked).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/nearby')).toBe(false);
});

it('shows submission video details and keeps older submissions readable', async () => {
  const url = 'https://www.bilibili.com/video/BV1xZWw6yEix';
  const legacy = { id: 'legacy', userId: 'A', url, reason: '适合下饭', status: 'pending', reply: '', at: 1 } as const;
  accounts.A.submissions = [legacy, {
    ...legacy, id: 'reviewed', status: 'approved', reply: '已核实', reason: '适合晚饭',
    video: { title: '视频标题', author: 'UP 主', durationSeconds: 219 },
  }];
  const user = userEvent.setup();
  mount(profile('A')); await loaded();
  await user.click(screen.getByText('我的账号', { selector: 'summary' }));
  await user.click(within(screen.getByRole('navigation', { name: '用户账户' })).getByRole('button', { name: '个人中心' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '投稿' }));
  const section = within(screen.getByRole('region', { name: '我的投稿' }));
  const [oldRow, reviewedRow] = section.getAllByRole('listitem').map(row => within(row));
  expect(oldRow.getByRole('link', { name: /BV1xZWw6yEix/ }).getAttribute('href')).toBe(url);
  expect(oldRow.getByText('待审核')).toBeTruthy();
  expect(reviewedRow.getByText('视频标题')).toBeTruthy();
  expect(reviewedRow.getByText('UP 主')).toBeTruthy();
  expect(reviewedRow.getByText('3:39')).toBeTruthy();
  expect(reviewedRow.getByText('已收录')).toBeTruthy();
  expect(reviewedRow.getByText('适合晚饭')).toBeTruthy();
  expect(reviewedRow.getByText('审核回复：已核实')).toBeTruthy();
});

it('binds wheel to account, keeps guest storage separate and isolates switching users', async () => {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, items: ['访客饺子'], history: [] }));
  const user = userEvent.setup();
  const view = mount(profile('A')); await loaded();
  expect(screen.queryByRole('button', { name: '删除访客饺子' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: '想吃什么' }), '小馄饨');
  await user.click(screen.getByRole('button', { name: '添加' }));
  await waitFor(() => expect(accounts.A.wheel.items).toEqual(['A的面', '小馄饨']));
  expect(screen.queryByRole('button', { name: '保存转盘' })).toBeNull();
  expect(JSON.parse(localStorage.getItem(KEY)!).items).toEqual(['访客饺子']);
  view.rerender(<IdentityContext.Provider value={profile('B')}><App /></IdentityContext.Provider>);
  await screen.findByRole('button', { name: '删除B的面' });
  expect(screen.queryByRole('button', { name: '删除小馄饨' })).toBeNull();
  view.rerender(<IdentityContext.Provider value={profile(null)}><App /></IdentityContext.Provider>);
  await screen.findByRole('button', { name: '删除访客饺子' });
});

it('keeps a conflicting wheel draft and reports it as not synchronized', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  await user.type(screen.getByRole('textbox', { name: '想吃什么' }), '冲突饭');
  denyWheel = true;
  await user.click(screen.getByRole('button', { name: '添加' }));
  await screen.findByText(/尚未同步：另一设备/);
  expect(screen.getByRole('button', { name: '删除冲突饭' })).toBeTruthy();
  expect(accounts.A.wheel.items).toEqual(['A的面']);
});

it('can spin again during a slow cloud save and synchronizes clearing history automatically', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  let release: () => void = () => undefined;
  wheelWriteGate = new Promise(resolve => { release = resolve; });
  await user.click(screen.getByRole('button', { name: '转一下，开饭！' }));
  const nextSpin = await screen.findByRole('button', { name: '再转一次' }) as HTMLButtonElement;
  await waitFor(() => expect(commands.filter(command => command.action === 'wheel')).toHaveLength(1));
  expect(nextSpin.disabled).toBe(false);
  expect(accounts.A.wheel.history).toHaveLength(0);
  await user.click(nextSpin);
  await screen.findByRole('button', { name: '再转一次' });
  expect(document.querySelectorAll('.history-list li')).toHaveLength(2);
  release();
  await waitFor(() => expect(accounts.A.wheel.history).toHaveLength(2));
  await user.click(screen.getByRole('button', { name: '清空记录' }));
  expect(document.querySelectorAll('.history-list li')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '保存转盘' })).toBeNull();
  await waitFor(() => expect(accounts.A.wheel.history).toHaveLength(0));
});

it('saves a recommended and manual-link favorite privately, without creating a submission', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  await screen.findAllByRole('button', { name: '收藏' });
  await user.click(screen.getAllByRole('button', { name: '收藏' })[0]);
  await waitFor(() => expect(accounts.A.favorites).toHaveLength(1));
  await user.click(screen.getByText('我的账号', { selector: 'summary' }));
  await user.click(within(screen.getByRole('navigation', { name: '用户账户' })).getByRole('button', { name: '个人中心' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: '添加收藏' }));
  await user.type(within(dialog).getByLabelText('B 站完整链接'), 'https://www.bilibili.com/video/BV14YTn6dEpE');
  await user.type(within(dialog).getByLabelText('标题或备注（选填）'), '自己的片单');
  await user.click(within(dialog).getByRole('button', { name: '添加到收藏' }));
  await waitFor(() => expect(accounts.A.favorites).toHaveLength(2));
  await within(dialog).findByText('已保存到我的收藏。');
  await user.click(within(dialog).getByRole('button', { name: '投稿' }));
  expect(within(dialog).queryByText('已保存到我的收藏。')).toBeNull();
  expect(accounts.A.submissions).toHaveLength(0);
  expect(accounts.B.favorites).toHaveLength(0);
});

it('does not show a late favorite confirmation on a different tab', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  await user.click(within(screen.getByRole('main')).getByRole('button', { name: '我的收藏' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: '添加收藏' }));
  await user.type(within(dialog).getByLabelText('B 站完整链接'), 'https://www.bilibili.com/video/BV14YTn6dEpE');
  let release: (saved: boolean) => void = () => undefined;
  videoWriteGate = new Promise(resolve => { release = resolve; });
  await user.click(within(dialog).getByRole('button', { name: '添加到收藏' }));
  await user.click(within(dialog).getByRole('button', { name: '投稿' }));
  await act(async () => { release(true); });
  expect(accounts.A.favorites).toHaveLength(1);
  expect(within(dialog).queryByText('已保存到我的收藏。')).toBeNull();
});

it('submits to the review queue and sends feedback through the site entry', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  const recommendations = screen.getByRole('region', { name: /饭有了/ });
  await user.click(within(recommendations).getByRole('button', { name: '投稿' }));
  const dialog = screen.getByRole('dialog');
  const inputs = within(dialog).getAllByRole('textbox');
  await user.type(inputs[0], 'https://www.bilibili.com/video/BV14YTn6dEpE');
  await user.type(inputs[1], '轻松有趣，适合吃饭看。');
  await user.click(within(dialog).getByRole('button', { name: /提交.*审核/ }));
  await waitFor(() => expect(accounts.A.submissions).toHaveLength(1));
  expect(accounts.A.submissions[0].status).toBe('pending');
  await user.click(within(dialog).getByRole('button', { name: '关闭窗口' }));
  await user.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: '意见反馈' }));
  const feedbackDialog = screen.getByRole('dialog');
  const text = within(feedbackDialog).getByRole('textbox', { name: /反馈内容|意见|具体/ });
  await user.type(text, '这里的链接需要核对一下。');
  await user.click(within(feedbackDialog).getByRole('button', { name: /(发送|提交)反馈/ }));
  await waitFor(() => expect(accounts.A.feedback).toHaveLength(1));
  expect(accounts.A.feedback[0].videoId).toBeUndefined();
});

it.each([['投稿', '我的投稿'], ['意见反馈', '我的反馈']])('opens %s after signing in', async (label, section) => {
  const user = userEvent.setup();
  const view = mount(profile(null));
  try {
    await user.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('dialog', { name: '登录 ShiLun' })).toBeTruthy();
    view.rerender(<IdentityContext.Provider value={profile('A')}><App /></IdentityContext.Provider>);
    const dialog = await screen.findByRole('dialog', { name: '我的账户' });
    expect(within(dialog).getByRole('region', { name: section })).toBeTruthy();
  } finally {
    window.history.replaceState(null, '', location.pathname);
  }
});

it('records contextual interest without claiming it is a playback', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  await screen.findAllByRole('button', { name: '喜欢' });
  const calls = () => vi.mocked(fetch).mock.calls.filter(([url]) => {
    const params = new URL(String(url), 'http://localhost').searchParams;
    return params.get('action') === 'recommendations' && !params.get('exclude');
  }).length;
  const beforeLike = calls();
  const cards = screen.getAllByRole('article');
  await user.click(screen.getAllByRole('button', { name: '喜欢' })[0]);
  await screen.findByRole('button', { name: '已喜欢' });
  const interest = commands.find(command => command.action === 'interest');
  expect(interest).toMatchObject({ action: 'interest', requestId: 'request-test', value: 'like', eventId: expect.any(String) });
  expect(calls()).toBe(beforeLike);
  expect(screen.getAllByRole('article')).toEqual(cards);
  await user.click(within(cards[1]).getByRole('button', { name: '不感兴趣' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toEqual(cards.filter((_, index) => index !== 1)));
  expect(calls()).toBe(beforeLike);
});

it('updates video controls before a slow write and restores a hidden card when saving fails', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  const [first, second] = await screen.findAllByRole('article');
  let release: (saved: boolean) => void = () => undefined;
  videoWriteGate = new Promise(resolve => { release = resolve; });

  await user.click(within(first).getByRole('button', { name: '喜欢' }));
  expect(within(first).getByRole('button', { name: '已喜欢' })).toBeDefined();
  const favorite = within(first).getByRole<HTMLButtonElement>('button', { name: '收藏' });
  expect(favorite.disabled).toBe(false);
  await user.click(favorite);
  expect(within(first).getByRole('button', { name: '已收藏' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(first).getByRole<HTMLButtonElement>('button', { name: '已喜欢' }).disabled).toBe(false);
  expect(accounts.A.favorites).toHaveLength(0);
  await user.click(within(second).getByRole('button', { name: '不感兴趣' }));
  expect(screen.getAllByRole('article')).toHaveLength(RECOMMENDATION_BATCH_SIZE - 1);

  release(false);
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(RECOMMENDATION_BATCH_SIZE));
  expect(within(first).getByRole('button', { name: '收藏' })).toBeDefined();
  expect(within(first).getByRole('button', { name: '喜欢' })).toBeDefined();
  expect(screen.getAllByRole('status').some(status => status.textContent?.includes('保存失败'))).toBe(true);
});

it('lets a user undo a like while its write is still pending', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  const [card] = await screen.findAllByRole('article');
  let release: (saved: boolean) => void = () => undefined;
  videoWriteGate = new Promise(resolve => { release = resolve; });
  await user.click(within(card).getByRole('button', { name: '喜欢' }));
  const liked = within(card).getByRole('button', { name: '已喜欢' }) as HTMLButtonElement;
  expect(liked.disabled).toBe(false);
  await user.click(liked);
  expect(within(card).getByRole('button', { name: '喜欢' }).getAttribute('aria-pressed')).toBe('false');
  let releaseUndo: (saved: boolean) => void = () => undefined;
  videoWriteGate = new Promise(resolve => { releaseUndo = resolve; });
  release(true);
  await waitFor(() => expect(commands.flatMap(input => input.action === 'interest' ? [input.value] : [])).toEqual(['like', null]));
  expect(within(card).getByRole('button', { name: '喜欢' }).getAttribute('aria-pressed')).toBe('false');
  releaseUndo(true);
  await waitFor(() => expect(card.querySelector('.video-personal-actions')?.getAttribute('aria-busy')).toBe('false'));
  expect(accounts.A.interests).toEqual({});
  expect(within(card).getByRole('button', { name: '喜欢' }).getAttribute('aria-pressed')).toBe('false');
});

it('uses the prepared batch and starts preparing the following one', async () => {
  recommendationSource = [0, 1, 2].flatMap(round => videos.map(video => ({ ...video, id: round ? `${round}-${video.id}` : video.id })));
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  const excludes = () => vi.mocked(fetch).mock.calls.flatMap(([url]) => {
    const params = new URL(String(url), 'http://localhost').searchParams;
    return params.get('action') === 'recommendations' && params.has('exclude') ? [params.get('exclude')] : [];
  });
  const current = recommendationSource.slice(0, 6).map(video => video.id).join(',');
  const next = recommendationSource.slice(6, 12).map(video => video.id).join(',');
  expect(await screen.findAllByRole('article')).toHaveLength(6);
  await waitFor(() => expect(excludes()).toContain(current));
  await user.click(screen.getByRole('button', { name: '换一批' }));
  await waitFor(() => expect(excludes()).toContain(current + ',' + next));
  expect(excludes().filter(value => value === current)).toHaveLength(1);
  expect(screen.getAllByRole('article').map(card => card.dataset.videoId)).toEqual(next.split(','));
  await user.click(screen.getByRole('button', { name: '换一批' }));
  const thirdBatch = recommendationSource.slice(12, 18).map(video => video.id);
  await waitFor(() => expect(screen.getAllByRole('article').map(card => card.dataset.videoId)).toEqual(thirdBatch));
  await user.click(screen.getByRole('button', { name: '换一批' }));
  await waitFor(() => expect(screen.getAllByRole('article').map(card => card.dataset.videoId)).toEqual(current.split(',')));
});

it('waits for a pending favorite before fetching a fresh next batch', async () => {
  const user = userEvent.setup();
  recommendationSource = [...videos, ...videos.map(video => ({ ...video, id: `extra-${video.id}` }))];
  const transport = globalThis.fetch;
  const favoritesAtFetch: number[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const query = new URL(url, 'http://localhost').searchParams;
    if (query.get('action') === 'recommendations' && query.get('exclude')) favoritesAtFetch.push(accounts.A.favorites.length);
    return transport(url, init);
  }));
  mount(profile('A')); await loaded();
  const [card] = await screen.findAllByRole('article');
  await waitFor(() => expect(favoritesAtFetch).toContain(0));
  let release: (saved: boolean) => void = () => undefined;
  videoWriteGate = new Promise(resolve => { release = resolve; });
  try {
    await user.click(within(card).getByRole('button', { name: '收藏' }));
    await user.click(screen.getByRole('button', { name: '换一批' }));
    expect(screen.getAllByRole('article')[0]).toBe(card);
    expect(accounts.A.favorites).toHaveLength(0);
  } finally {
    release(true);
  }
  await waitFor(() => expect(screen.getAllByRole('article')[0]).not.toBe(card));
  expect(favoritesAtFetch).toContain(1);
});

it('shows only duration settings and saves durations without legacy content preferences', async () => {
  const user = userEvent.setup();
  accounts.A.preferences = ['影视', '治愈', '探店试吃', '30分钟以上'];
  mount(profile('A')); await loaded();
  await user.click(screen.getByText('我的账号', { selector: 'summary' }));
  await user.click(within(screen.getByRole('navigation', { name: '用户账户' })).getByRole('button', { name: '个人中心' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '偏好' }));
  const ui = within(screen.getByRole('region', { name: '推荐偏好' }));
  const dialog = screen.getByRole('dialog');
  expect(ui.getAllByRole('checkbox')).toHaveLength(3);
  expect(ui.getByRole<HTMLInputElement>('checkbox', { name: '30分钟以上' }).checked).toBe(true);
  await user.click(ui.getByRole('checkbox', { name: '10分钟以内' }));
  await user.click(ui.getByRole('button', { name: '保存偏好' }));
  await waitFor(() => expect(accounts.A.preferences).toEqual(['30分钟以上', '10分钟以内']));
  await within(dialog).findByText('推荐偏好已保存。');
  await user.click(ui.getByRole('checkbox', { name: '30分钟以上' }));
  await user.click(ui.getByRole('checkbox', { name: '10分钟以内' }));
  await user.click(ui.getByRole('button', { name: '保存偏好' }));
  await waitFor(() => expect(accounts.A.preferences).toEqual([]));
  await within(dialog).findByText('推荐偏好已保存。');
  await user.click(within(dialog).getByRole('button', { name: '关闭窗口' }));
  await user.click(screen.getByText('我的账号', { selector: 'summary' }));
  await user.click(within(screen.getByRole('navigation', { name: '用户账户' })).getByRole('button', { name: '个人中心' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '偏好' }));
  expect(within(screen.getByRole('region', { name: '推荐偏好' })).queryByRole('checkbox', { checked: true })).toBeNull();
});

it('cleans modal focus on native cancel', async () => {
  const user = userEvent.setup(); mount(profile('A')); await loaded();
  const button = screen.getByText('我的账号', { selector: 'summary' });
  await user.click(button);
  await user.click(within(screen.getByRole('navigation', { name: '用户账户' })).getByRole('button', { name: '个人中心' }));
  act(() => { fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button);
});

it('offers recovery after a failed account read and locks wheel editing until it succeeds', async () => {
  const transport = globalThis.fetch;
  let calls = 0;
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('action=account')) {
      if (++calls === 1) return Promise.resolve(result({ error: '账户暂时无法读取' }, 503));
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return transport(url, init);
  }));
  const user = userEvent.setup(); mount(profile('A'));
  await user.click(await screen.findByRole('button', { name: '重新读取' }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: '想吃什么' }) as HTMLInputElement).disabled).toBe(true));
  await act(async () => { finish(result({ ...accounts.A, wheel: { revision: 1, items: ['新云端菜单'], history: [] } })); });
  await screen.findByRole('button', { name: '删除新云端菜单' });
});

it('does not resurrect seed videos before catalog loads or during an outage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  const view = mount(profile(null));
  expect(view.container.querySelectorAll('.video-card')).toHaveLength(0);
  await screen.findByText('片单暂时无法读取，请稍后重试。');
  expect(view.container.querySelectorAll('.video-card')).toHaveLength(0);
});
