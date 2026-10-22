// Reader-to-newsroom forms and the ad desk, one function for several public API paths and the /advertise page (vercel.json rewrites them here):
//   /api/submit     -> /api/inbox?__route=submit     news tips ("Submit news"), handler in api/_submit.js
//   /api/advertise  -> /api/inbox?__route=advertise  advertising inquiries, handler in api/_advertise.js
//   /api/creative   -> /api/inbox?__route=creative   advertiser creatives: upload, admin review, approved ads, in api/_creative.js
//   /api/campaigns  -> /api/inbox?__route=campaigns  ad campaigns (dates, caps), admin only, in api/_campaigns.js
//   /api/packages   -> /api/inbox?__route=packages   self-serve ad package orders (public order + admin), in api/_packages.js
//   /api/adstats    -> /api/inbox?__route=adstats    cookie-free daily ad view and click counts, in api/_adstats.js
//   /advertise      -> /api/inbox?__route=adpage     the advertising page behind ADS_PAGE, in api/_adpage.js
// Each path keeps its own methods, admin GET (x-admin-key), rate limits and answers. /api/inbox itself answers 404.
module.exports = require('./_dispatch.js').host({
  submit: () => require('./_submit.js'),
  advertise: () => require('./_advertise.js'),
  creative: () => require('./_creative.js'),
  campaigns: () => require('./_campaigns.js'),
  packages: () => require('./_packages.js'),
  adstats: () => require('./_adstats.js'),
  adpage: () => require('./_adpage.js')
});
