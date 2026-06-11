const { serve } = require('@hono/node-server');
const { createApp } = require('./app');

const app = createApp();
const port = Number(process.env.PORT || 8787);

console.log(`[seraph-pictures] Starting Docker runtime on :${port}`);

serve({ fetch: app.fetch, port });
