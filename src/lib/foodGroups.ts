export const FOOD_SEARCHES = [
  {
    group: '探店试吃',
    terms: ['街头小吃探店', '路边摊探店'],
    title: /探店|街[头边]小吃|路边摊|试吃|逛吃/,
    tags: /^(?:探店|美食探店|街[头边]小吃|街头美食|路边摊|夜市|美食测评)$/,
  },
  {
    group: '烹饪制作',
    terms: ['家常菜菜谱', '家常菜做法'],
    title: /家常菜|下饭菜|菜谱|怎么做|做道菜/,
    tags: /^(?:家常菜|烹饪|美食制作|料理制作|美食教程|菜谱|厨艺|做菜)$/,
  },
] as const;

export type FoodGroup = typeof FOOD_SEARCHES[number]['group'];
export const FOOD_GROUPS = FOOD_SEARCHES.map(rule => rule.group);

export function classifyFoodVideo(title: string, tags: readonly string[]): FoodGroup | undefined {
  const normalized = tags.map(tag => tag.normalize('NFKC').trim().replace(/^#+|#+$/g, '').trim());
  const matching = FOOD_SEARCHES.filter(rule => rule.title.test(title) || normalized.some(tag => rule.tags.test(tag)));
  if (matching.length !== 1) return undefined;
  const group = matching[0].group;
  if (group === '探店试吃' && /摆摊卖|摆摊日记|出摊日记/.test(title)) return undefined;
  return group;
}
