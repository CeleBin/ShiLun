import { AppError } from '../src/lib/accountRules';
import { classifyNearbyStore, type NearbyFood, type NearbyStore } from '../src/shared/nearbyFood';

const radius = 2000;
const pageSize = 25;
// Amap limits each search to 200 results across pages.
const maxPages = 200 / pageSize;
const parallelPages = 3;

export interface Coordinates { longitude: number; latitude: number }

export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== 'object') return false;
  const { longitude, latitude } = value as Partial<Coordinates>;
  return typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90;
}

interface Poi { name?: unknown; type?: unknown; typecode?: unknown; distance?: unknown }
interface AmapResult { status?: string; infocode?: string; locations?: string; pois?: unknown }

async function requestAmap(path: string, key: string, params: Record<string, string>, retry = true): Promise<AmapResult> {
  const url = new URL(path, 'https://restapi.amap.com');
  url.search = new URLSearchParams({ ...params, key }).toString();
  let data: AmapResult;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('Map request failed');
    data = await response.json();
  } catch {
    throw new AppError(503, 'NEARBY_UNAVAILABLE', '附近餐饮暂时查不到，请稍后再试。');
  }
  if (data?.status !== '1') {
    if (retry && data?.infocode === '10021') {
      await new Promise(resolve => setTimeout(resolve, 1100));
      return requestAmap(path, key, params, false);
    }
    if (['10001', '10002', '10005', '10007', '10009'].includes(data?.infocode ?? '')) {
      throw new AppError(503, 'NEARBY_CONFIGURATION', '附近餐饮服务配置有误，请联系维护者。');
    }
    throw new AppError(503, 'NEARBY_UNAVAILABLE', '附近餐饮暂时查不到，请稍后再试。');
  }
  return data;
}

async function readRestaurants(location: string, key: string, page: number): Promise<Poi[]> {
  const result = await requestAmap('/v3/place/around', key, {
    location, types: '050000', radius: String(radius), sortrule: 'distance', offset: String(pageSize), page: String(page),
  });
  if (!Array.isArray(result.pois)) throw new AppError(503, 'NEARBY_UNAVAILABLE', '附近餐饮暂时查不到，请稍后再试。');
  return result.pois.filter((poi): poi is Poi => !!poi && typeof poi === 'object');
}

export async function findNearbyFood(coordinates: Coordinates, key: string): Promise<NearbyFood> {
  const { longitude, latitude } = coordinates;
  const converted = await requestAmap('/v3/assistant/coordinate/convert', key, {
    coordsys: 'gps', locations: `${longitude.toFixed(6)},${latitude.toFixed(6)}`,
  });
  const location = typeof converted.locations === 'string' ? converted.locations.trim() : '';
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(location);
  const convertedCoordinates = { longitude: Number(match?.[1]), latitude: Number(match?.[2]) };
  if (!validCoordinates(convertedCoordinates)) {
    throw new AppError(503, 'NEARBY_UNAVAILABLE', '转换定位失败，请稍后再试。');
  }

  const searchLocation = `${convertedCoordinates.longitude.toFixed(6)},${convertedCoordinates.latitude.toFixed(6)}`;
  let lastPage = await readRestaurants(searchLocation, key, 1);
  const restaurants = [...lastPage];
  for (let page = 2; page <= maxPages && lastPage.length === pageSize; page += parallelPages) {
    const batch = await Promise.all(Array.from(
      { length: Math.min(parallelPages, maxPages - page + 1) },
      (_, index) => readRestaurants(searchLocation, key, page + index),
    ));
    for (const results of batch) restaurants.push(...results);
    lastPage = batch[batch.length - 1];
  }
  const stores = new Map<string, NearbyStore & { category: string }>();
  for (const poi of restaurants) {
    const type = typeof poi.type === 'string' ? poi.type : '';
    const name = typeof poi.name === 'string' ? poi.name.trim() : '';
    const diningCode = typeof poi.typecode === 'string' && /(?:^|\|)05\d{4}(?:\||$)/.test(poi.typecode);
    if (!diningCode && !type.split(/[;|]/).includes('餐饮服务')) continue;
    const rawDistance = poi.distance;
    const meters = typeof rawDistance === 'number' || (typeof rawDistance === 'string' && rawDistance.trim())
      ? Number(rawDistance) : NaN;
    if (meters > radius) continue;
    const distance = Number.isFinite(meters) && meters >= 0 ? Math.round(meters) : null;
    const previous = stores.get(name);
    if (name && (!previous || (distance ?? Infinity) < (previous.distance ?? Infinity))) {
      stores.set(name, { name, distance, category: classifyNearbyStore(name, type) });
    }
  }
  const sorted = [...stores.values()].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  return {
    categories: [...new Set(sorted.map(store => store.category))],
    stores: sorted,
  };
}
