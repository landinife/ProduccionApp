// Arma la versión web: dist/ (para Netlify) o web/test/ (con Firebase simulado)
const esbuild = require('/opt/npm-tools/node_modules/esbuild'); const fs = require('fs'); const path = require('path');
const test = process.argv[2] === 'test'; const out = test ? 'web/test/sitio' : 'dist';
const fake = { name: 'fake', setup(b) { b.onResolve({ filter: /sdk\.js$/ }, a => a.importer.includes('datos-firebase') ? { path: path.resolve('web/test/sdk-fake.js') } : undefined); } };
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
esbuild.buildSync === undefined;
esbuild.build({ entryPoints: ['web/main-web.jsx'], bundle: true, minify: true, format: 'esm', jsx: 'automatic', outfile: out + '/app.js', nodePaths: ['/opt/npm-tools/node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' }, external: ['https://www.gstatic.com/*'], plugins: test ? [fake] : [], logLevel: 'warning', legalComments: 'none' }).then(() => {
  fs.copyFileSync('styles.css', out + '/styles.css');
  ['manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', '_headers'].forEach(f => { if (fs.existsSync('web/pub/' + f)) fs.copyFileSync('web/pub/' + f, out + '/' + f); });
  fs.writeFileSync(out + '/index.html', `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ProducciónApp</title><meta name="theme-color" content="#151a20"><meta name="description" content="Control de producción del taller">
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap">
<link rel="stylesheet" href="styles.css"><style>html,body{margin:0;height:100%}#root{min-height:100%}</style>
</head><body><div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" defer></script>
<script type="module" src="app.js"></script></body></html>
`);
  console.log('ok', out, (fs.statSync(out + '/app.js').size / 1024 | 0) + 'KB');
}).catch(e => { console.error(e.message); process.exit(1); });
