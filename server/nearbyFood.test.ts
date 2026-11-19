import { afterEach, expect, it, vi } from 'vitest';
import { findNearbyFood, validCoordinates } from './nearbyFood';

const coordinates = { longitude: 116.397499, latitude: 39.908722 };
const convertedLocation = '116.403741590712,39.910124511719';
const result = (body: object) => Promise.resolve(Response.json({ status: '1', ...body }));

afterEach(() => vi.unstubAllGlobals());

it('converts GPS coordinates and returns nearby dining types and real store names', async () => {
  const fetcher = vi.fn<(url: URL) => Promise<Response>>()
    .mockImplementationOnce(() => result({ locations: convertedLocation }))
    .mockImplementationOnce(() => result({ pois: [
      { name: '兰州拉面', type: '餐饮服务;快餐厅;快餐厅', distance: '25' },
      { name: '重庆小面', typecode: '050300', distance: '50' },
      { name: '某中餐厅', type: '餐饮服务;中餐厅;川菜', distance: '100' },
      { name: '老北京火锅', typecode: '050117', distance: '1600' },
      { name: '兰州拉面', typecode: '050300', distance: '20' },
      { name: '如意餐厅', typecode: '050100' },
      { name: '披萨', typecode: '060000', distance: '150' },
      { name: '寿司', typecode: '050202', distance: '2001' },
    ] }));
  vi.stubGlobal('fetch', fetcher);

  expect(await findNearbyFood(coordinates, 'test-key')).toEqual({
    categories: ['面馆', '川菜', '火锅', '其他餐饮'],
    stores: [
      { name: '兰州拉面', distance: 20, category: '面馆' },
      { name: '重庆小面', distance: 50, category: '面馆' },
      { name: '某中餐厅', distance: 100, category: '川菜' },
      { name: '老北京火锅', distance: 1600, category: '火锅' },
      { name: '如意餐厅', distance: null, category: '其他餐饮' },
    ],
  });
  const [[convert], [search]] = fetcher.mock.calls;
  expect(convert.pathname).toBe('/v3/assistant/coordinate/convert');
  expect(convert.searchParams.get('coordsys')).toBe('gps');
  expect(convert.searchParams.get('locations')).toBe('116.397499,39.908722');
  expect(search.pathname).toBe('/v3/place/around');
  expect(search.searchParams.get('location')).toBe('116.403742,39.910125');
  expect(search.searchParams.get('types')).toBe('050000');
  expect(search.searchParams.get('radius')).toBe('2000');
});

it('loads all pages within the Amap limit before grouping restaurants', async () => {
  const fetcher = vi.fn((url: URL) => {
    if (url.pathname.endsWith('/convert')) return result({ locations: convertedLocation });
    const page = Number(url.searchParams.get('page'));
    return result({ count: '600', pois: Array.from({ length: 25 }, (_, index) => ({
      name: `面馆${page}-${index}`,
      typecode: '050100',
      distance: 25 * (page - 1) + index,
    })) });
  });
  vi.stubGlobal('fetch', fetcher);

  const { categories, stores } = await findNearbyFood(coordinates, 'test-key');
  expect(categories).toEqual(['面馆']);
  expect(stores).toHaveLength(200);
  expect(stores.at(-1)?.name).toBe('面馆8-24');
  expect(fetcher.mock.calls.slice(1).map(([url]) => Number(url.searchParams.get('page')))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

it('uses Amap dining subtypes to classify stores with generic names', async () => {
  const fetcher = vi.fn<(url: URL) => Promise<Response>>()
    .mockImplementationOnce(() => result({ locations: convertedLocation }))
    .mockImplementationOnce(() => result({ pois: [
      { name: '如意餐厅', type: '餐饮服务;中餐厅;中餐厅', distance: '10' },
      { name: '晴日小店', type: '餐饮服务;甜品店;甜品店', distance: '20' },
      { name: '南池子小店', type: '餐饮服务;冷饮店;冷饮店', distance: '30' },
      { name: '西街小店', type: '餐饮服务;糕饼店;糕饼店', distance: '40' },
      { name: '东街小店', type: '住宿服务;宾馆酒店;五星级宾馆|餐饮服务;咖啡厅;咖啡厅', distance: '50' },
    ] }));
  vi.stubGlobal('fetch', fetcher);

  const { categories } = await findNearbyFood(coordinates, 'test-key');
  expect(categories).toEqual(['中式正餐', '甜品', '饮品', '烘焙', '咖啡']);
});

it('stops when Amap has not returned a usable converted location', async () => {
  const fetcher = vi.fn(() => result({ locations: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(findNearbyFood(coordinates, 'test-key')).rejects.toMatchObject({ status: 503 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('rejects invalid coordinates', () => {
  expect(validCoordinates(coordinates)).toBe(true);
  expect(validCoordinates({ longitude: 116, latitude: 91 })).toBe(false);
  expect(validCoordinates({ longitude: '116', latitude: 39 })).toBe(false);
});
