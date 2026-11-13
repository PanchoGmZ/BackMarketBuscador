import { hydrateLocalApifyToken } from './local-auth.js';
import { loadLocalEnvironment } from './local-env.js';

// Local `apify run` keeps the CLI login in its credential store and does not
// expose it to the Actor process. Hydrate it only in memory for SDK proxy auth.
loadLocalEnvironment();
hydrateLocalApifyToken();
await import('./main.js');
