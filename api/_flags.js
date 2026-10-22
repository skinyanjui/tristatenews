// Server-side feature flags for the county expansion (plan §9). Read here only; all default off.
// A flag is on only when its env var is exactly "true" (any other value, or unset, is off). Values are never echoed.
//   COUNTY_CLASSIFICATION_ENABLED  stage B, shadow mode: refresh classifies each story's county and stores the
//                                  result privately (tsn:loc:shadow). Nothing readers see changes.
//   COUNTY_FILTERS_ENABLED, EXPANDED_SOURCES_ENABLED, SOURCE_ADMIN_ENABLED, REGIONAL_ROUTES_ENABLED
//                                  reserved for later stages; nothing reads them yet.
const NAMES = ['COUNTY_CLASSIFICATION_ENABLED', 'COUNTY_FILTERS_ENABLED', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_ADMIN_ENABLED', 'REGIONAL_ROUTES_ENABLED'];

function on(name, env) { return String((env || process.env)[name] || '').trim().toLowerCase() === 'true'; }
// { COUNTY_CLASSIFICATION_ENABLED: false, ... } booleans only.
function all(env) { const o = {}; for (const n of NAMES) o[n] = on(n, env); return o; }
const countyClassification = env => on('COUNTY_CLASSIFICATION_ENABLED', env);

module.exports = { NAMES, on, all, countyClassification };
