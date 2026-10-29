#!/usr/bin/env node
// The home page's CSS and JS are cacheable files under public/assets (a year, immutable, vercel.json), each loaded
// from public/index.html with ?v=<content hash> so a change is picked up at once:
//   assets/app.css   the page's styles (with the self-hosted Geist @font-face rules, assets/fonts)
//   assets/lib.js    LIBS (breaking, routes, featured, adslots, adsizes, flowers) in that order, then the call that
//                    points the head at the current tab; built from those files, which stay in public/ for the other
//                    pages and the tests. Loaded with defer in <head>, before app.js.
//   assets/app.js    the page script, defer in <head> (runs after the document is parsed, as at the end of <body>)
// Run after editing any of them:  node scripts/build-assets.js   (test/assets.test.js fails when lib.js or a hash is
// stale). Run against an index.html that still has the inline <style>/<script> blocks, it moves them out first.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PUB = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUB, 'index.html');
const CSS = path.join(PUB, 'assets', 'app.css');
const JS = path.join(PUB, 'assets', 'app.js');
const LIB = path.join(PUB, 'assets', 'lib.js');
const LIBS = ['breaking.js', 'routes.js', 'featured.js', 'adslots.js', 'adsizes.js', 'flowers.js'];
const APPLY = '/* each tab has its own URL: set this one\'s title, description and canonical first */ if (window.TSNRoutes) TSNRoutes.apply(document, TSNRoutes.byPath(location.pathname));';

const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const cssTag = v => '<link rel="stylesheet" href="/assets/app.css?v=' + v + '">';
const jsTag = v => '<script defer src="/assets/app.js?v=' + v + '"></script>';
const libTag = v => '<script defer src="/assets/lib.js?v=' + v + '"></script>';
const libSource = () => LIBS.map(f => '/* ---- public/' + f + ' ---- */\n' + fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\s*$/, '\n')).join(';\n') + ';\n' + APPLY + '\n';

function build() {
  let html = fs.readFileSync(INDEX, 'utf8');
  const style = /\n<style>\n([\s\S]*?)<\/style>\n<\/head>/.exec(html);
  if (style) { fs.mkdirSync(path.dirname(CSS), { recursive: true }); fs.writeFileSync(CSS, style[1]); html = html.replace(style[0], '\n' + cssTag('x') + '\n</head>'); }
  const script = /\n<script>\n(\(function \(\) \{[\s\S]*?)<\/script>\n<\/body>/.exec(html);
  if (script) { fs.writeFileSync(JS, script[1]); html = html.replace(script[0], '\n</body>').replace('</head>', jsTag('x') + '\n</head>'); }
  fs.writeFileSync(LIB, libSource());
  html = html.replace(/<link rel="stylesheet" href="\/assets\/app\.css\?v=[^"]*">/, cssTag(hash(fs.readFileSync(CSS, 'utf8'))))
    .replace(/<script defer src="\/assets\/lib\.js\?v=[^"]*"><\/script>/, libTag(hash(fs.readFileSync(LIB, 'utf8'))))
    .replace(/<script defer src="\/assets\/app\.js\?v=[^"]*"><\/script>/, jsTag(hash(fs.readFileSync(JS, 'utf8'))));
  fs.writeFileSync(INDEX, html);
}

if (require.main === module) build();
module.exports = { build, hash, cssTag, jsTag, libTag, libSource, LIBS, APPLY, INDEX, CSS, JS, LIB };
