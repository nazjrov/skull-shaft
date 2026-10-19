// Plays the level with a bot that presses exactly on the map's hops. Needs: npm i -D playwright && npx playwright install chromium
// Usage: node tools/build.mjs --test && node tools/bot-test.mjs [offsetInBeats]
// Expected: state "won" at offsets -0.2 .. +0.15 (timing window); dies around +0.32.
import {chromium} from "playwright";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const off = Number(process.argv[2] || 0);
const b = await chromium.launch({args: ["--autoplay-policy=no-user-gesture-required"]});
const p = await b.newPage({viewport: {width: 390, height: 780}});
p.on("pageerror", e => console.log("ERR", e.message));
await p.goto(pathToFileURL(path.join(root, "test-out/bot.html")).href);
await p.waitForTimeout(2500);
await p.evaluate(o => { window.__bot = true; window.__off = o; }, off);
await p.click("#toLevels");
await p.click("#play");
let last;
for (let i = 0; i < 70; i++){ await p.waitForTimeout(500); last = await p.evaluate(() => window.__info()); if (last.state !== "play") break; }
console.log("offset", off, JSON.stringify(last));
await b.close();
if (off === 0 && last?.state !== "won") process.exit(1);
