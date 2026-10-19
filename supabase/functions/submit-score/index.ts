// Приём рекорда из игры в Telegram.
// Проверяет подпись Telegram (initData) токеном бота и пишет рекорд в public.scores.
// Правило «только вверх» стоит в самой базе (триггер scores_only_up).
// Секрет BOT_TOKEN владелец задаёт сам в Supabase → Edge Functions → Secrets.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_AGE_SEC = 24 * 60 * 60; // подпись Telegram действительна сутки

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Возвращает пользователя Telegram, если подпись верна, иначе null
async function checkInitData(initData: string, botToken: string) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  if (hex(await hmac(secret, dcs)) !== hash) return null;
  const authDate = Number(p.get("auth_date")) || 0;
  if (Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) return json({ error: "no_bot_token" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const user = await checkInitData(String(body.initData || ""), botToken);
  if (!user || !user.id) return json({ error: "bad_auth" }, 401);

  const best = Math.floor(Number(body.best));
  const att = Math.floor(Number(body.att));
  const ver = String(body.ver || "").slice(0, 40);
  if (!(best >= 0 && best <= 100) || !(att >= 1) || !ver) return json({ error: "bad_data" }, 400);
  const clearAtt = best >= 100 ? Math.max(1, Math.floor(Number(body.clearAtt)) || att) : 0;

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 64) || user.username || "Игрок";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.from("scores")
    .upsert({ tg_id: user.id, ver, name, photo: user.photo_url || null, best, att, clear_att: clearAtt }, { onConflict: "tg_id,ver" })
    .select("best, att, clear_att")
    .single();
  if (error) return json({ error: "db" }, 500);
  return json({ ok: true, best: data.best, att: data.att, clearAtt: data.clear_att });
});
