// The Tri-State places the site covers, for feeds that publish for a whole state or a wide district
// (FBI field offices, U.S. Attorneys): their items are kept only when they name one of these places.
// Counties: IN Vanderburgh, Warrick, Posey, Gibson, Pike, Dubois, Spencer; KY Henderson, Daviess, Union,
// Webster, Hopkins, Ohio, McLean; IL White, Wabash, Edwards, Gallatin, Wayne. Towns are the county seats and
// main towns (the ones in the page's town list, LOCS in public/index.html, that fall in these counties).
//
// Each state has two lists:
//   anywhere: names unique enough to count wherever they appear ("Evansville", "Owensboro").
//   local:    names shared with places elsewhere ("Henderson", "Princeton", "Fairfield", "Gibson County").
//             They count when written with their state ("Henderson, Ky.", "Fairfield, Illinois") or, bare,
//             in a feed from that same state (an FBI Springfield release that says "Fairfield" means Fairfield, Ill.).
// The file has no route: Vercel does not turn files that start with "_" into functions.
const PLACES = {
  ind: {
    anywhere: ['evansville', 'vanderburgh', 'warrick county', 'posey county', 'poseyville', 'new harmony', 'haubstadt', 'fort branch', 'oakland city',
      'dubois county', 'huntingburg', 'ferdinand, ind', 'santa claus, ind', 'spencer county, ind', 'pike county, ind', 'gibson county, ind',
      'boonville, ind', 'newburgh, ind', 'chandler, ind', 'lynnville', 'elberfeld', 'tennyson, ind', 'darmstadt', 'wadesville', 'cynthiana, ind',
      'owensville, ind', 'patoka, ind', 'petersburg, ind', 'winslow, ind', 'jasper, ind', 'holland, ind', 'birdseye', 'rockport, ind', 'dale, ind',
      'grandview, ind', 'chrisney', 'mount vernon, ind', 'mt. vernon, ind', 'princeton, ind'],
    local: ['warrick', 'posey', 'gibson county', 'pike county', 'spencer county', 'boonville', 'newburgh', 'chandler', 'mount vernon', 'mt. vernon',
      'princeton', 'owensville', 'petersburg', 'jasper', 'rockport', 'santa claus', 'ferdinand'],
  },
  ky: {
    anywhere: ['owensboro', 'henderson, ky', 'henderson county, ky', 'daviess county, ky', 'union county, ky', 'webster county, ky', 'hopkins county, ky',
      'ohio county, ky', 'mclean county, ky', 'morganfield', 'uniontown, ky', 'sturgis, ky', 'sebree', 'providence, ky', 'dixon, ky', 'clay, ky',
      'madisonville, ky', 'earlington', 'nortonville', 'dawson springs', 'hanson, ky', 'hartford, ky', 'beaver dam, ky', 'fordsville', 'centertown',
      'calhoun, ky', 'livermore, ky', 'island, ky', 'sacramento, ky', 'corydon, ky', 'robards', 'spottsville', 'whitesville, ky', 'philpot', 'utica, ky'],
    local: ['henderson', 'henderson county', 'daviess county', 'union county', 'webster county', 'hopkins county', 'ohio county', 'mclean county',
      'madisonville', 'uniontown', 'sturgis', 'providence', 'hartford', 'beaver dam', 'calhoun', 'livermore', 'corydon', 'whitesville'],
  },
  ill: {
    anywhere: ['carmi', 'grayville', 'norris city', 'crossville, ill', 'enfield, ill', 'white county, ill', 'mount carmel, ill', 'mt. carmel, ill',
      'allendale, ill', 'wabash county, ill', 'albion, ill', 'west salem, ill', 'edwards county, ill', 'shawneetown', 'ridgway, ill', 'equality, ill',
      'gallatin county, ill', 'fairfield, ill', 'cisne', 'wayne county, ill'],
    local: ['white county', 'wabash county', 'edwards county', 'gallatin county', 'wayne county', 'mount carmel', 'mt. carmel', 'allendale', 'albion',
      'west salem', 'ridgway', 'crossville', 'fairfield', 'enfield'],
  },
};
const STATE_ABBR = { kentucky: 'ky', indiana: 'ind', illinois: 'ill', 'ky.': 'ky', 'ind.': 'ind', 'ill.': 'ill', ky: 'ky', ind: 'ind', ill: 'ill', in: 'ind', il: 'ill' };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = list => new RegExp('(?:^|[^a-z])(?:' + list.map(esc).join('|') + ')(?![a-z])');
const ANY = words([].concat(PLACES.ind.anywhere, PLACES.ky.anywhere, PLACES.ill.anywhere));
const LOCAL = { ind: words(PLACES.ind.local), ky: words(PLACES.ky.local), ill: words(PLACES.ill.local) };

// "Henderson, Kentucky" / "Henderson, Ky." / "Carmi, IL" -> "henderson, ky" / "carmi, ill"
function fold(text) {
  return String(text || '').toLowerCase().replace(/\u2019/g, "'")
    .replace(/,\s*(kentucky|indiana|illinois|ky\.?|ind\.?|ill\.?|in|il)(?![a-z])/g, (m, st) => ', ' + STATE_ABBR[st]);
}
// state: the feed's own state ('ind', 'ky' or 'ill'), or null for a feed that is not tied to one state.
function inTriState(item, state) {
  const hay = fold((item.title || '') + ' ' + (item.summary || ''));
  if (ANY.test(hay)) return true;
  return !!(state && LOCAL[state] && LOCAL[state].test(hay));
}
module.exports = { PLACES, inTriState, fold };
