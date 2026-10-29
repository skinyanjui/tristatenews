// The home page as one string: public/index.html with public/assets/app.css and app.js put back inline where they
// load, exactly as the page was before they moved out (scripts/build-assets.js). Tests that read the page's
// markup, CSS and script together use this.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
module.exports = function pageSource() {
  return rd('public/index.html')
    .replace(/<link rel="stylesheet" href="\/assets\/app\.css\?v=[^"]*">/, () => '<style>\n' + rd('public/assets/app.css') + '</style>')
    .replace(/<script src="\/assets\/app\.js\?v=[^"]*"><\/script>/, () => '<script>\n' + rd('public/assets/app.js') + '</script>');
};
