#!/bin/bash
set -e
cd /home/claude/prod
export NODE_PATH=/opt/npm-tools/node_modules
/opt/npm-tools/node_modules/.bin/esbuild main-local.jsx --bundle --minify --format=iife --jsx=automatic --define:process.env.NODE_ENV='"production"' --outfile=bundle.js --log-level=warning
node -e '
const fs=require("fs");
const css=fs.readFileSync("styles.css","utf8");
const js=fs.readFileSync("bundle.js","utf8").replace(/<\/script/gi,"<\\/script");
const head=`<title>ProducciónApp</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@600;700&display=swap">
<style>\n${css}</style>
<div id="root"></div>
`;
fs.writeFileSync("ProduccionApp.html", head+`<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n<script>${js}</script>\n`);
fs.writeFileSync("test.html", `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body>`+head+`<script>${js}</script></body></html>`);
console.log("ok", (js.length/1024|0)+"KB");
'
