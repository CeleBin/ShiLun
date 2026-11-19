import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { characters, MAX_ITEMS, MAX_NAME_LENGTH } from '../lib/domain';
import { classifyNearbyStore, OTHER_DINING, type NearbyFood, type NearbyStore } from '../shared/nearbyFood';
import { AccountDialog } from './AccountPanel';
import { Icon } from './Icons';

interface Props {
  items: string[];
  busy: boolean;
  onAdd: (items: readonly string[]) => string;
}

const cacheKey = 'shilun.nearby.v1';
interface Cache { results: NearbyFood; checked: string[] }

function isNearbyFood(value: unknown): value is NearbyFood {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<NearbyFood>;
  return Array.isArray(data.categories) && data.categories.every(name => typeof name === 'string')
    && Array.isArray(data.stores) && data.stores.every(store => store && typeof store.name === 'string'
      && (store.category === undefined || typeof store.category === 'string')
      && (store.distance === null || Number.isFinite(store.distance)));
}

function groupNearbyFood(results: NearbyFood) {
  const groups = new Map<string, NearbyStore[]>(results.categories.map(name => [name, []]));
  for (const store of results.stores) {
    const name = store.category ?? classifyNearbyStore(store.name);
    const group = groups.get(name);
    if (group) group.push(store);
    else groups.set(name, [store]);
  }
  return groups;
}

function readCache(): Cache | null {
  try {
    const data = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
    if (isNearbyFood(data?.results) && Array.isArray(data.checked)) {
      return { results: data.results, checked: data.checked.filter((name: unknown) => typeof name === 'string') };
    }
  } catch { /* Storage can be unavailable in this browser. */ }
  return null;
}

function wheelNames(groups: Map<string, NearbyStore[]>) {
  const names = [...new Set([...groups].flatMap(([category, stores]) => [category, ...stores.map(store => store.name)]))];
  const parts = names.map(name => ({ name, letters: characters(name) }));
  const labels = new Map(parts.filter(({ letters }) => letters.length <= MAX_NAME_LENGTH)
    .map(({ name }) => [name, name]));
  const used = new Set(labels.values());
  for (const { name, letters } of parts) {
    if (labels.has(name)) continue;
    let suffix = '…';
    let shortName = letters.slice(0, MAX_NAME_LENGTH - suffix.length).join('') + suffix;
    for (let index = 2; used.has(shortName); index++) {
      suffix = `…${index}`;
      shortName = letters.slice(0, MAX_NAME_LENGTH - suffix.length).join('') + suffix;
    }
    labels.set(name, shortName);
    used.add(shortName);
  }
  return labels;
}

function getPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) return Promise.reject(new Error('当前浏览器无法定位。'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, error => {
      reject(new Error(error.code === 1 ? '定位权限未开启，请在浏览器设置中允许定位。' : '暂时无法获取定位，请重试。'));
  }, { timeout: 8000, maximumAge: 0 });
  });
}

export function NearbyFoodPicker({ items, busy, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [cache, setCache] = useState(readCache);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addError, setAddError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [collapsedMatches, setCollapsedMatches] = useState<string[]>([]);
  const treeId = useId();
  const request = useRef<AbortController | null>(null);
  const remaining = MAX_ITEMS - items.length;
  const results = cache?.results;
  const groups = useMemo(() => results && groupNearbyFood(results), [results]);
  const names = useMemo(() => groups && wheelNames(groups), [groups]);
  const keyword = keywordInput.trim().toLowerCase();
  const visibleGroups = [...(groups ?? [])]
    .sort(([a], [b]) => Number(a === OTHER_DINING) - Number(b === OTHER_DINING))
    .flatMap(([category, stores]) => {
      if (!keyword) return [[category, stores] as const];
      const matches = stores.filter(store => store.name.toLowerCase().includes(keyword));
      return matches.length ? [[category, matches] as const] : [];
    });
  const selected = (cache?.checked ?? []).filter(name => {
    const wheelName = names?.get(name);
    return wheelName && !items.includes(wheelName);
  });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!cache) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); }
    catch { /* The results are still available in memory. */ }
  }, [cache]);

  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setSearchError('');
    setAddError('');
    try {
      const { coords } = await getPosition();
      if (controller.signal.aborted) return;
      const { longitude, latitude } = coords;
      const response = await fetch('/api/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ longitude, latitude }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(26000)]),
      }).catch(() => { throw new Error('附近餐饮暂时查不到，请稍后再试。'); });
      const body = await response.json().catch(() => null);
      if (!response.ok || !isNearbyFood(body)) {
        throw new Error(typeof body?.error === 'string' ? body.error : '附近餐饮暂时查不到，请稍后再试。');
      }
      if (!controller.signal.aborted) {
        setCache(previous => {
          const available = wheelNames(groupNearbyFood(body));
          return { results: body, checked: (previous?.checked ?? []).filter(name => available.has(name)) };
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setSearchError(error instanceof Error ? error.message : '附近餐饮暂时查不到。');
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function show() {
    setOpen(true);
    setAddError('');
    setKeywordInput('');
    setCollapsedMatches([]);
    if (!cache && !loading && !searchError) void search();
  }

  function addSelected() {
    if (busy || loading || !names || !selected.length || selected.length > remaining) return;
    const error = onAdd(selected.map(name => names.get(name)!));
    if (error) setAddError(error);
    else {
      setCache(current => current && { ...current, checked: [] });
      setOpen(false);
    }
  }

  function option(name: string, distance?: number | null) {
    const wheelName = names?.get(name) ?? name;
    const added = items.includes(wheelName);
    const active = selected.includes(name);
    const store = distance !== undefined;
    return <label className={`account-topic${store ? ' nearby-store' : ''}`} key={name}>
      <input type="checkbox" checked={active} disabled={loading || added || (!active && selected.length >= remaining)}
        onChange={() => {
          setAddError('');
          setCache(current => current && {
            ...current,
            checked: active ? current.checked.filter(value => value !== name) : [...current.checked, name],
          });
        }} />
      <span className="nearby-option-name">{name}{added && '（已加入）'}
        {wheelName !== name && <small>转盘显示为 {wheelName}</small>}
      </span>
      {distance != null && <small className="nearby-distance">{distance} 米</small>}
    </label>;
  }

  return <>
    <button className="text-button nearby-trigger" type="button" disabled={busy} onClick={show}>从附近选</button>
    {open && <AccountDialog title="附近吃什么" onClose={() => setOpen(false)} compact>
      <div className="nearby-picker">
        <div className="nearby-toolbar">
          <p>附近 2 公里</p>
          <button type="button" className="text-button nearby-trigger" disabled={loading} onClick={search}>刷新附近店铺</button>
        </div>
        {loading && <p role="status">正在定位并查询附近餐饮…</p>}
        {searchError && <p role="alert">{searchError}{cache && ' 已保留上次结果。'}</p>}
        {groups && <>
          {groups.size > 0 && <input className="nearby-filter" type="search" aria-label="筛选店名"
            placeholder="筛选店名" autoComplete="off" value={keywordInput}
            onChange={event => {
              setKeywordInput(event.target.value);
              setCollapsedMatches([]);
            }} />}
          {visibleGroups.length ? <ul className="nearby-results" aria-label="餐饮类型和店铺">
            {visibleGroups.map(([category, stores], index) => {
              const expanded = keyword ? !collapsedMatches.includes(category) : expandedGroups.includes(category);
              const groupId = `${treeId}-${index}`;
              const selectedStores = groups.get(category)?.filter(store => selected.includes(store.name)).length ?? 0;
              return <li className="nearby-group" key={category}>
                <div className="nearby-category">
                  {option(category)}
                  {stores.length > 0 && <button type="button" className="nearby-expand"
                    aria-label={`${expanded ? '折叠' : '展开'}${category}店铺`}
                    aria-expanded={expanded} aria-controls={groupId} aria-describedby={`${groupId}-count`}
                    onClick={() => {
                      if (keyword) setCollapsedMatches(current => expanded
                        ? [...current, category] : current.filter(name => name !== category));
                      else setExpandedGroups(current => expanded
                        ? current.filter(name => name !== category) : [...current, category]);
                    }}>
                    <span className="nearby-group-count" id={`${groupId}-count`}>
                      {stores.length} 家{selectedStores > 0 && <> · <span className="nearby-selected-count">已选 {selectedStores} 家</span></>}
                    </span>
                    <Icon name="chevron" size={15} />
                  </button>}
                </div>
                {stores.length > 0 && <ul id={groupId} className="nearby-stores" hidden={!expanded}>
                  {stores.map(({ name, distance }) => <li key={name}>{option(name, distance)}</li>)}
                </ul>}
              </li>;
            })}
          </ul> : <p role="status">{keyword ? '没有店名包含这个关键词。' : '附近暂无可选餐饮。'}</p>}
          {addError && <p role="alert">{addError}</p>}
          <div className="nearby-toolbar nearby-footer">
            <p aria-live="polite">已选 {selected.length} 项 · 还可加 {Math.max(0, remaining - selected.length)} 项</p>
            <button type="button" className="account-primary" onClick={addSelected}
              disabled={busy || loading || !selected.length || selected.length > remaining}>加入转盘</button>
          </div>
        </>}
      </div>
    </AccountDialog>}
  </>;
}
