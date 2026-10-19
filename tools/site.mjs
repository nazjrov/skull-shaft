// Prepares the published site in site/ from dist/index.html (run build.mjs first).
// site/index.html   - tiny loader: asks version.json (never cached) which game file is current and opens it
// site/game-<v>.html - the game itself under a new name each release, so Telegram can't show an old copy
// site/version.json  - {"v": "<v>"}
// Usage: node tools/site.mjs [version]   (default version: current time)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v = (process.argv[2] || new Date().toISOString().replace(/\D/g, "").slice(0, 14)).replace(/[^\w.-]/g, "");
const out = path.join(root, "site");
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out);
const game = "game-" + v + ".html";
fs.copyFileSync(path.join(root, "dist/index.html"), path.join(out, game));
fs.writeFileSync(path.join(out, "version.json"), JSON.stringify({v}));
// keeps ?query and #hash: Telegram passes the player's data in #tgWebAppData=..., the editor uses #edit
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<title>Skull Shaft</title>
<style>html,body{margin:0;height:100%;background:#0b0b0d}</style>
</head><body>
<script>
(function(){
  var go = function(v){ location.replace("game-" + v + ".html" + location.search + location.hash); };
  fetch("version.json?t=" + Date.now(), {cache: "no-store"})
    .then(function(r){ return r.json(); })
    .then(function(j){ go(j.v); })
    .catch(function(){ go(${JSON.stringify(v)}); });
})();
</script>
</body></html>
`);
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log("site/ ok, version " + v);
