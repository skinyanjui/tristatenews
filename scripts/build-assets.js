#!/usr/bin/env node
// The home page's CSS and JS live in public/assets/app.css and public/assets/app.js (cached for a year by
// vercel.json), loaded from public/index.html with a ?v=<content hash> so a change is picked up at once.
// Run after editing either file:  node scripts/build-assets.js   (rewrites the ?v= in index.html; test/assets.test.js
// fails when a hash is stale). Run against an index.html that still has the inline <style>/<script> blocks, it
// moves them out first.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PUB = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUB, 'index.html');
const CSS = path.join(PUB, 'assets', 'app.css');
const JS = path.join(PUB, 'assets', 'app.js');

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const cssTag = v => '<link rel="stylesheet" href="/assets/app.css?v=' + v + '">';
const jsTag = v => '<script src="/assets/app.js?v=' + v + '"></script>';

function build() {
  let html = fs.readFileSync(INDEX, 'utf8');
  const style = /\n<style>\n([\s\S]*?)<\/style>\n<\/head>/.exec(html);
  if (style) { fs.mkdirSync(path.dirname(CSS), { recursive: true }); fs.writeFileSync(CSS, style[1]); html = html.replace(style[0], '\n' + cssTag('x') + '\n</head>'); }
  const script = /\n<script>\n(\(function \(\) \{[\s\S]*?)<\/script>\n<\/body>/.exec(html);
  if (script) { fs.writeFileSync(JS, script[1]); html = html.replace(script[0], '\n' + jsTag('x') + '\n</body>'); }
  html = html.replace(/<link rel="stylesheet" href="\/assets\/app\.css\?v=[^"]*">/, cssTag(hash(fs.readFileSync(CSS, 'utf8'))))
    .replace(/<script src="\/assets\/app\.js\?v=[^"]*"><\/script>/, jsTag(hash(fs.readFileSync(JS, 'utf8'))));
  fs.writeFileSync(INDEX, html);
}

if (require.main === module) build();
module.exports = { build, hash, cssTag, jsTag, INDEX, CSS, JS };
