export interface NearbyStore {
  name: string;
  distance: number | null;
  category?: string;
}

export interface NearbyFood {
  categories: string[];
  stores: NearbyStore[];
}

export const OTHER_DINING = '其他餐饮';

const categories = [
  ['麻辣烫', /麻辣烫|冒菜/], ['火锅', /火锅|涮羊肉|涮肉/], ['烤鱼', /烤鱼/],
  ['烧烤', /烧烤|烤串|烤肉/], ['炸鸡汉堡', /炸鸡|汉堡/], ['披萨', /披萨|比萨/],
  ['面馆', /面馆|面食|拉面|小面|刀削面|牛肉面|拌面|面条/],
  ['米粉米线', /米粉|米线|螺蛳粉|酸辣粉|河粉/], ['饺子馄饨', /饺子|水饺|馄饨|抄手/],
  ['盖饭快餐', /盖饭|盖浇饭|盒饭|便当|煲仔饭/],
  ['川菜', /川菜|四川菜|川味/], ['湘菜', /湘菜|湖南菜|湘味/], ['粤菜', /粤菜|广东菜|粤式|潮州菜|潮汕菜/],
  ['东北菜', /东北菜|东北风味/], ['江浙菜', /江浙菜|杭帮菜|本帮菜|江苏菜|浙江菜/],
  ['日料', /日料|日本料理|寿司|刺身/], ['韩餐', /韩餐|韩国料理|韩式/],
  ['东南亚菜', /泰国菜|泰式|越南菜|泰国\/越南菜品/],
  ['西餐', /西餐|牛排|牛扒|意式菜品|法式菜品/], ['海鲜', /海鲜/],
  ['咖啡', /咖啡/], ['烘焙', /烘焙|糕饼|糕点|面包|蛋糕/], ['甜品', /甜品|冰淇淋|雪糕|糖水/],
  ['饮品', /冷饮|饮品|奶茶|茶饮|茶艺馆|果汁/],
  ['小吃', /小吃|小食/], ['快餐', /快餐/],
] as const;

export function classifyNearbyStore(name: string, type = ''): string {
  const category = categories.find(([, pattern]) => pattern.test(`${type} ${name}`));
  if (category) return category[0];
  return type.split(/[;|]/).includes('中餐厅') ? '中式正餐' : OTHER_DINING;
}
