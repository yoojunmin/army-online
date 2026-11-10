const express = require('express');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, game: 'iron-front' }));
app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));
app.get('*path', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`IRON FRONT listening on port ${port}`);
});
