// Reader-to-newsroom forms, one function for three public API paths and the /advertise page (vercel.json rewrites them here):
//   /api/submit     -> /api/inbox?__route=submit     news tips ("Submit news"), handler in api/_submit.js
//   /api/advertise  -> /api/inbox?__route=advertise  advertising inquiries, handler in api/_advertise.js
//   /api/creative   -> /api/inbox?__route=creative   advertiser creatives: upload, admin review, approved ads, in api/_creative.js
//   /advertise      -> /api/inbox?__route=adpage     the advertising page behind ADS_PAGE, in api/_adpage.js
// Each path keeps its own methods, admin GET (x-admin-key), rate limits and answers. /api/inbox itself answers 404.
module.exports = require('./_dispatch.js').host({
  submit: () => require('./_submit.js'),
  advertise: () => require('./_advertise.js'),
  creative: () => require('./_creative.js'),
  adpage: () => require('./_adpage.js')
});
