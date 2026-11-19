import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function installApi(server: Pick<ViteDevServer, 'middlewares'>) {
  const routes = { app: () => import('./api/app'), auth: () => import('./api/auth'), nearby: () => import('./api/nearby') };
  for (const [route, loadHandler] of Object.entries(routes)) server.middlewares.use(`/api/${route}`, async (req, res) => {
    const response = res as VercelResponse;
    response.status = code => { res.statusCode = code; return response; };
    response.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); return response; };
    try {
      const request = req as VercelRequest;
      const url = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      request.query = Object.fromEntries([...url.searchParams.keys()].map(key => { const all = url.searchParams.getAll(key); return [key, all.length === 1 ? all[0] : all]; }));
      if (req.method === 'POST') {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 32768) { response.status(413).json({ error: '提交内容过大。' }); return; } chunks.push(buffer); }
        request.body = Buffer.concat(chunks).toString('utf8');
      }
      const { default: handler } = await loadHandler();
      await handler(request, response);
    } catch { if (!res.headersSent) response.status(503).json({ error: '服务暂时不可用，请稍后重试。' }); }
  });
}
function localApi(): Plugin { return { name: 'shilun-local-api', configureServer: installApi, configurePreviewServer: installApi }; }
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [react(), localApi()] };
});
