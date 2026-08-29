import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Serves the /api serverless handlers inside the Vite dev server so `npm run
// dev` is enough to exercise the whole app. Production still runs them as
// Vercel functions; this only shims the req/res surface they rely on.
function apiDevServer() {
  return {
    name: 'valuscope-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '');

        try {
          const mod = await server.ssrLoadModule(`/api/${route}.js`);
          const shimRes = {
            statusCode: 200,
            setHeader: (k, v) => res.setHeader(k, v),
            status(code) { this.statusCode = code; return this; },
            json(body) {
              res.statusCode = this.statusCode;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(body));
              return body;
            },
          };
          await mod.default(
            { query: Object.fromEntries(url.searchParams), method: req.method, url: req.url, headers: { host: req.headers.host, 'x-forwarded-proto': 'http' } },
            shimRes,
          );
        } catch (err) {
          server.config.logger.error(`[api] ${route}: ${err.message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The /api handlers read process.env directly, the way they will on Vercel.
  // Vite parses .env but does not populate process.env for server-side code, so
  // the values are copied across here — otherwise anything key-dependent
  // silently behaves as if it were unconfigured in local dev.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return { plugins: [react(), apiDevServer()] };
});
