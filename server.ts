import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleChatStreamRequest,
  handleChatTitleRequest,
  handleHealthRequest,
  handleRobotsRequest,
  handleSitemapRequest,
  resolveBaseUrl,
} from './server/chatEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT =
  process.env.NODE_ENV === 'production'
    ? Number(process.env.PORT) || 3000
    : 3000;

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '24mb' }));

  app.get('/robots.txt', (req: Request, res: Response) => {
    handleRobotsRequest(req, res);
  });

  app.get('/sitemap.xml', (req: Request, res: Response) => {
    handleSitemapRequest(req, res);
  });

  app.get('/api/health', (req: Request, res: Response) => {
    handleHealthRequest(req, res);
  });

  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    await handleChatStreamRequest(req, res);
  });

  app.post('/api/chat/title', async (req: Request, res: Response) => {
    await handleChatTitleRequest(req, res);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    const cachedHtml = fs.existsSync(indexHtmlPath)
      ? fs.readFileSync(indexHtmlPath, 'utf-8')
      : '';

    app.use(express.static(distPath, { index: false }));
    app.get('*', (req: Request, res: Response) => {
      if (!cachedHtml) {
        res.sendFile(indexHtmlPath);
        return;
      }
      const baseUrl = resolveBaseUrl(req);
      const seoTags = `<link rel="canonical" href="${baseUrl}/" />\n    <meta property="og:url" content="${baseUrl}/" />`;
      const htmlWithCanonical = cachedHtml.replace('</head>', `    ${seoTags}\n  </head>`);
      res.type('text/html').send(htmlWithCanonical);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Unknown AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
