import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plugin Proxy CORS nội bộ
const corsProxyPlugin = () => ({
  name: 'cors-proxy',
  configureServer(server) {
    const fs = require('fs');
    const path = require('path');

    server.middlewares.use(async (req, res, next) => {
      if (req.url.startsWith('/api/save-credentials')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            fs.writeFileSync(path.join(__dirname, 'credentials_backup.json'), JSON.stringify(data, null, 2), 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.statusCode = 400;
            res.end(`Error saving: ${err.message}`);
          }
        });
        return;
      }

      if (req.url.startsWith('/api/load-credentials')) {
        try {
          const filePath = path.join(__dirname, 'credentials_backup.json');
          if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
          } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'No credentials backup found' }));
          }
        } catch (err) {
          res.statusCode = 500;
          res.end(`Error loading: ${err.message}`);
        }
        return;
      }

      if (req.url.startsWith('/cors-proxy')) {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const targetUrl = urlParams.searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400;
          res.end('Missing url parameter');
          return;
        }

        try {
          const targetRes = await fetch(targetUrl);
          if (!targetRes.ok) {
            res.statusCode = targetRes.status;
            res.end(`Failed to fetch: ${targetRes.statusText}`);
            return;
          }

          const contentType = targetRes.headers.get('content-type');
          if (contentType) {
            res.setHeader('content-type', contentType);
          }
          res.setHeader('Access-Control-Allow-Origin', '*');

          const arrayBuffer = await targetRes.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        } catch (err) {
          res.statusCode = 500;
          res.end(`Proxy error: ${err.message}`);
        }
        return;
      }
      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), corsProxyPlugin()],
  server: {
    proxy: {
      '/fb-api': {
        target: 'https://graph.facebook.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fb-api/, '')
      },
      '/fb-upload': {
        target: 'https://video-rupload.facebook.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fb-upload/, '')
      },
      '/fb-rupload': {
        target: 'https://rupload.facebook.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fb-rupload/, '')
      },
      '/google-token': {
        target: 'https://oauth2.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/google-token/, '')
      },
      '/youtube-api': {
        target: 'https://www.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/youtube-api/, '')
      }
    }
  }
})
