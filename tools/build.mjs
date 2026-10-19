// Builds the single-file game: dist/index.html (everything inlined: track, skull model, beat data).
// Usage: node tools/build.mjs          -> dist/index.html
//        node tools/build.mjs --test   -> also test-out/bot.html (auto-player) and test-out/god.html (no collisions)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = p => fs.readFileSync(path.join(root, p));
const txt = p => rd(p).toString("utf8");
const b64 = p => rd(p).toString("base64");
let g = txt("src/game.html");
const put = (ph, val) => { if (!g.includes(ph)) throw new Error("placeholder missing: " + ph); g = g.replace(ph, () => val); };
put("/*DATA*/", txt("src/beats.js"));
put("/*TRACK*/", b64("assets/track.mp3"));
put("/*SKIMG*/", b64("assets/skull-fallback.png"));
put("/*SKULLGL*/", txt("src/skullgl.js"));
put("/*EDITOR*/", txt("src/editor.js"));
put("/*SKGLB*/", b64("assets/skull.glb"));
fs.mkdirSync(path.join(root, "dist"), {recursive: true});
fs.writeFileSync(path.join(root, "dist/index.html"), g);
// syntax check of every inline script
let bad = 0;
for (const m of g.matchAll(/<script>([\s\S]*?)<\/script>/g)){ try { new Function(m[1]); } catch(e){ bad++; console.error("SYNTAX:", e.message); } }
console.log(bad ? "build has syntax errors" : "dist/index.html ok (" + (g.length / 1e6).toFixed(2) + " MB)");
if (bad) process.exit(1);
if (process.argv.includes("--test")){
  let s = g.replace("<title>", '<meta charset="utf-8"><title>');
  const bot = `  if (state === "play" && window.__bot){
    const tb = (clock() - PH) / SPB;
    if (p.mode === "wave"){ const c = corrAt(tb + 0.03); const want = c ? c.c > p.x : p.x < W/2; holding = SECTIONS[curSec].kind === "mirror" ? !want : want; }
    window.__di = window.__di || 0;
    while (window.__di < DOORS.length && tb >= DOORS[window.__di].b + (window.__off||0)){ press(); window.__di++; }
  }
  if (state === "play" || state === "won"){`;
  s = s.replace('  if (state === "play" || state === "won"){', () => bot);
  s = s.replace("buildLevel();\n", () => 'buildLevel();\nwindow.__info = () => ({state, pct, beat: beatNow, doors: DOORS.length});\n');
  fs.mkdirSync(path.join(root, "test-out"), {recursive: true});
  fs.writeFileSync(path.join(root, "test-out/bot.html"), s);
  fs.writeFileSync(path.join(root, "test-out/god.html"), s.replace("!godMode && hit(beat)", "false && hit(beat)"));
  console.log("test-out/bot.html + god.html ok");
}
