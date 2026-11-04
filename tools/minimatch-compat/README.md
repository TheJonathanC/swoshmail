# minimatch-compat (dev-only)

ESLint and its plugins depend on `minimatch@3` / `@10`, which are affected by
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (fixed only in 11.0.1+).
They call `require("minimatch")(path, pattern)`, an API minimatch >= 9 no longer exports, so
`package.json` `overrides` points every `minimatch` at this folder: minimatch@11.0.4 bundled
(no dependencies) and re-exported as both a callable default and the named API.

Rebuild after bumping the version:

```bash
mkdir /tmp/mm && cd /tmp/mm && npm init -y && npm i minimatch@11 esbuild
cat > entry.js <<'JS'
const real = require("minimatch");
const impl = real.minimatch;
function minimatch(path, pattern, options) { return impl(path, pattern, options); }
Object.assign(minimatch, impl);
minimatch.minimatch = minimatch;
minimatch.default = minimatch;
module.exports = minimatch;
JS
npx esbuild entry.js --bundle --platform=node --format=cjs --target=node18 --outfile=index.js --legal-comments=inline
```

Copy `index.js` here, update `version` in `package.json`, then `npm install`. Production code never uses this.
