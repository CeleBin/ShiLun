# ShiLun

把纠结交给转盘，把快乐留给餐桌。

第一版只做两件事：**自定义转盘决定吃什么，以及推荐下饭视频、跳转 B 站观看。** 不含餐食推荐、账号、后台或数据库。

## 本地使用

需要 Node.js 22.12 或更新版本。

```powershell
cd C:\Users\14375\dinner-helper
npm install
npm run dev
```

开发地址默认为 http://127.0.0.1:5173/，以启动时输出为准。

```powershell
npm test
npm run build
npm run preview -- --port 4173 --strictPort
```

生产预览地址：http://127.0.0.1:4173/。`dist/` 是构建产物。

## 已实现的范围

- 自己添加、删除转盘选项，最多 16 项，每项最多 16 个可见字符，支持中文与组合 emoji。
- 等概率抽选，最终指针与结果一致；旋转期间禁止修改，支持系统减少动态效果设置。
- 记住当前浏览器的转盘选项，允许空菜单，支持恢复默认和最近 8 条历史。
- 6 条人工精选的视频/节目推荐，每次展示 3 条，可换一批；新标签跳转原站。
- 手机、平板和电脑布局，键盘操作及存储失败提示。

## “记住当前浏览器的转盘选项”是什么

使用当前网站的浏览器 localStorage，键为 `shilun.wheel.v1`。选项及历史不上传，不额外生成文件，也不依赖服务器或数据库。

在同一台设备、同一个浏览器、同一个网站来源（协议、域名、端口）再次打开时可恢复。换设备、换浏览器或换域名不自动同步；清除网站数据后会丢失，无痕窗口关闭后通常清除。本地文件参考页的数据不会自动迁移过来。

保存被禁用、空间已满或记录损坏时，会明确提示，当前页面仍可继续添加和抽选。对于来自未知新版本的数据，本版不覆盖，避免破坏其他版本的记录。

## 维护下饭视频

编辑 `src/data/videos.ts`，填写唯一 `id`、B 站完整 `url`、真实 `title`、`author`、一句自己的 `reason`、插画类型 `artwork`、卡片文案 `label`，以及用于维护核对的 `source`、`verifiedAt`。

允许的跳转地址：

- `https://www.bilibili.com/video/BV...`
- `https://www.bilibili.com/bangumi/play/ss...` 或 `ep...`
- 也支持不带 `www` 的相同域名；禁止短链、非 HTTPS、其他域名、账号信息、非默认端口和追踪参数。

新增条目前核实标题、作者和原始页面；链接去掉跟踪参数。修改后运行 `npm test`、`npm run build` 并重新发布。删除或替换失效条目即可下架，无需清理用户菜单。

插画是本站自绘的示意图，非视频封面；不复制视频、图片或播放量。首批元信息根据 B 站页面/搜索索引人工核对，来源保存在条目里；不表示已经完整观看或实时验证播放，会员要求以原平台为准。用户最初提供的 `BV14YTn6dEpE` 暂未核实，保留在 RFC 作为待整理示例，未冒充已核实精选发布。

## 验证

- `npm test`：14 项核心规则和内容检查，涵盖增删限制、可见字符、损坏数据恢复、随机数拒绝采样、1—16 项的转盘角度及安全视频链接。
- `npm run build`：严格 TypeScript 检查和 Vite 生产构建。
- `scripts/browser_check.py`：16 组真实浏览器流程，包括刷新恢复、空菜单、单项抽选、正常动画锁定、指针一致、存储禁用/超限、损坏记录、未知版本、换片单和三种屏幕宽度。

浏览器检查需 Python Playwright 和 Chromium；安装说明：

```powershell
python -m pip install playwright
python -m playwright install chromium
```

先启动生产预览，再在另一个终端运行：

```powershell
python scripts/browser_check.py --url http://127.0.0.1:4173/ --output test-results
```

本次验证记录在 `docs/verification/2026-11-11-v1.md`。未在真实 Vercel 域名、移动设备实机或 B 站播放器内测试。

## 部署到 Vercel 和 Cloudflare

仓库已提供 `vercel.json`，首版不需要环境变量或 Upstash。部署准备就绪不等于已经上线；尚未创建线上项目或变更 DNS。

1. 将本项目放入你指定的 Git 远程仓库（当前尚未配置远程仓库或推送），在 Vercel 新建独立项目；也可按你的发布习惯使用 Vercel CLI 部署此目录。
2. 使用 Vite 框架，构建命令 `npm run build`，输出目录 `dist`，Node 版本满足项目要求。
3. 先验证 Vercel 默认域名上的编辑、刷新恢复、抽选和视频跳转。
4. 确定子域名后，在新 Vercel 项目的 Domains 中添加；`eat.agent-room.com` 仅为此前候选，尚未确定。
5. 在 Cloudflare 新增该子域名对应的记录，类型和目标严格使用 Vercel 本次给出的值，不改主域名及 Agent Room 现有记录。
6. 等待域名验证和 HTTPS 就绪，在最终域名重测；默认域名与子域名之间的浏览器记录互不共享。

回退时使用 Vercel 旧部署；视频库随代码版本回退，不主动删除个人浏览器记录。

参考：[Vercel 域名配置](https://vercel.com/docs/domains/working-with-domains/add-a-domain)、[Cloudflare 子域名记录](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/)。

## 范围文档

- [RFC-0001](docs/rfcs/review/RFC-0001-v1-scope.md)：IN_PROGRESS；F1—F7 已本地验证，F8 线上发布待配置。
- [实施计划](docs/superpowers/plans/2026-11-11-shilun-v1.md)

保留现有 `.gitignore` 对 `docs/` 的忽略规则；这些文档当前留在本机，本次未强制纳入版本管理。依赖、构建产物和本地环境文件也不会纳入版本管理。
