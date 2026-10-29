// The home page as one string, laid out as it was before its CSS and JS moved to public/assets
// (scripts/build-assets.js): app.css inline in <head>; the six library scripts as their own <script src> tags followed
// by the inline call that points the head at the tab (lib.js); app.js inline at the end of <body>. Tests that read
// the page's markup, CSS and script together use this; test/assets*.test.js check the real layout.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const B = require('../scripts/build-assets.js');
module.exports = function pageSource() {
  return rd('data/pages/index.html')
    .replace(/<link rel="stylesheet" href="\/assets\/app\.css\?v=[^"]*">/, () => '<style>\n' + rd('public/assets/app.css') + '</style>')
    .replace(/<script defer src="\/assets\/lib\.js\?v=[^"]*"><\/script>\n?/, () => B.LIBS.map(f => '<script src="/' + f + '"></script>\n').join('') + '<script>' + B.APPLY + '</script>\n')
    .replace(/<script defer src="\/assets\/app\.js\?v=[^"]*"><\/script>\n?/, '')
    .replace(/\n<\/body>/, () => '\n<script>\n' + rd('public/assets/app.js') + '</script>\n</body>');
};
