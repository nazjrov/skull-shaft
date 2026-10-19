// ---------- map editor (owner only): a scrollable beat timeline of the real level ----------
let savedMap = null, liveMapPending = null, edPlaying = false, edScroll = 0, edPPB = 64, edSnap = 0.25, edSel = null, edHist = [], edCanSave = false;
let edDrag = null, edToastT = 0;
const edCv = $("edCv"), edCtx = edCv.getContext("2d");
const EDKEY = "ss_ed_draft";
const SEC_NAME = {intro: "ВОЛНА", mirror: "ЗЕРКАЛО", drop: "СТЕНЫ · ДРОП", end: "ФИНИШ"};
const SEC_BG = {intro: "#121118", mirror: "#17112a", drop: "#220a0e", end: "#100508"};
const fmtB = b => (Math.round(b * 1000) / 1000).toString().replace(".", ",");
const fmtT = b => { const t = Math.max(0, PH + b * SPB); return Math.floor(t / 60) + ":" + (t % 60).toFixed(1).padStart(4, "0"); };

function wallSec(){ const i = SECTIONS.findIndex(q => q.m === "wall"); return {S: SECTIONS[i], b1: SECTIONS[i+1].b0}; }
function wallTaps(m){ const {S, b1} = wallSec(); return m.taps.filter(t => t >= S.b0 + 1 && t <= b1 - 0.6); }
function edToast(t){ const el = $("edToast"); el.textContent = t; el.hidden = false; edToastT = performance.now() + 2200; }

// apply a map for normal play (records belong to the map's version)
function applyLevel(m){
  MAP = cleanMap(m); buildLevel();
  const v = mapVer(MAP);
  if (v !== LEVEL){
    LEVEL = v;
    best = Number(store.get("ss_" + LEVEL + "_best")) || 0;
    attempts = Number(store.get("ss_" + LEVEL + "_att")) || 0;
    clearAtt = Number(store.get("ss_" + LEVEL + "_clear")) || 0;
    served = {best: 0, clearAtt: 0};
    if (db && uid) db.doc(LBCOL + "/" + uid).get().then(d => { if (d.exists){ const q = d.data(); if (String(q.ver || "lvl1v4") === LEVEL) served = {best: Number(q.best) || 0, clearAtt: Number(q.clearAtt) || 0}; } }).catch(() => {});
    filterRows(); updateMenuPB();
  }
}
function edCommit(next, keepSel){
  const prev = MAP, n = cleanMap(next);
  if (mapKey(n) === mapKey(prev)) return;
  edHist.push(prev); if (edHist.length > 120) edHist.shift();
  MAP = n; buildLevel();
  const want = keepSel !== undefined && keepSel !== null ? keepSel : edSel;
  edSel = want !== null && MAP.taps.includes(want) ? want : null;
  try { store.set(EDKEY, JSON.stringify(MAP)); } catch(e){}
  edUI();
}
function edDirty(){ return mapKey(MAP) !== mapKey(savedMap || DEFMAP); }

function openEditor(){
  stopSong(true); edStopListen();
  state = "edit"; fromEditor = true;
  let draft = null; try { draft = JSON.parse(store.get(EDKEY) || "null"); } catch(e){}
  MAP = cleanMap(draft || savedMap || DEFMAP); buildLevel();
  edHist = []; edSel = null; edScroll = Math.max(edScroll, 0);
  $("menu").hidden = true; $("over").hidden = true; $("hud").hidden = true; $("editor").hidden = false;
  $("edGod").textContent = godMode ? "бессмертие вкл" : "бессмертие выкл"; $("edGod").classList.toggle("on", godMode);
  edUI();
}
function closeEditor(){
  edStopListen(); fromEditor = false;
  applyLevel(liveMapPending || savedMap || DEFMAP); liveMapPending = null;
  state = "menu"; resetRun();
  $("editor").hidden = true; $("over").hidden = true; $("menu").hidden = false; updateMenuPB(); renderBoards();
}
function backToEditor(){
  stopSong(false); state = "edit"; resetRun();
  $("over").hidden = true; $("hud").hidden = true; $("editor").hidden = false;
  if (runFrom > 0) edScroll = runFrom;
  edUI();
}

// ---- listening: the song plays from the cursor and the map scrolls with it
function edListen(){
  if (edPlaying){ edStopListen(); return; }
  initAudio(); if (ac && ac.state === "suspended") ac.resume();
  if (!ac){ edToast("Звук недоступен"); return; }
  edPlaying = true;
  startSong(ac.currentTime + 0.06, Math.max(0, PH + edScroll * SPB));
  edUI();
}
function edStopListen(){ if (!edPlaying) return; edPlaying = false; stopSong(false); edUI(); }
function edAddNow(){
  if (!edPlaying || !ac) return;
  const lat = (ac.outputLatency || 0) + (ac.baseLatency || 0);
  const b = Math.round(((ac.currentTime - startAt - lat - PH) / SPB) / edSnap) * edSnap;
  if (b <= 0 || b > FINISH) return;
  if (MAP.taps.includes(b)){ edToast("Тут уже есть прыжок"); return; }
  edCommit({...MAP, taps: [...MAP.taps, b]}, b);
}

// ---- geometry of the timeline
function edGeom(){
  const w = edCv.clientWidth, h = edCv.clientHeight, cy = Math.round(h * 0.62), lm = 44, rm = 10;
  return {w, h, cy, lm, sx: x => lm + x / W * (w - lm - rm), sy: b => cy - (b - edScroll) * edPPB, bAt: y => edScroll + (cy - y) / edPPB};
}
// where the hero is at a tap: the corridor centre in the wave, the wall it lands on in the drop
function tapX(b){
  const sec = SECTIONS[secAt(b)];
  if (sec.m === "wave"){ const c = corrAt(b); return {x: c ? c.c : W/2, used: corrs.some(q => q.V.some(v => Math.abs(v.b - b) < 1e-6))}; }
  const d = DOORS.find(q => Math.abs(q.b - b) < 1e-6);
  return d ? {x: attachX(d.to), used: true, post: d.to === 0} : {x: W/2, used: false};
}

function edDraw(){
  const dpr2 = Math.min(window.devicePixelRatio || 1, 2), cw = Math.round(edCv.clientWidth * dpr2), ch = Math.round(edCv.clientHeight * dpr2);
  if (edCv.width !== cw || edCv.height !== ch){ edCv.width = cw; edCv.height = ch; }
  const g = edCtx, G = edGeom(); g.setTransform(dpr2, 0, 0, dpr2, 0, 0);
  const {w, h, cy, sx, sy} = G, bTop = G.bAt(0), bBot = G.bAt(h);
  g.fillStyle = "#07060b"; g.fillRect(0, 0, w, h);
  // sections
  for (let i = 0; i < SECTIONS.length - 1; i++){
    const S = SECTIONS[i], b0 = S.b0, b1 = Math.min(SECTIONS[i+1].b0, FINISH + 4);
    if (b1 < bBot || b0 > bTop) continue;
    const yA = sy(b1), yB = sy(b0);
    g.fillStyle = SEC_BG[S.kind] || "#0d0c12"; g.fillRect(G.lm, yA, w - G.lm, yB - yA);
  }
  // corridors (wave): rock outside, the open corridor inside
  for (const c of corrs){
    const a = Math.max(c.fa, bBot - 0.1), z = Math.min(c.fb, bTop + 0.1); if (z <= a) continue;
    g.fillStyle = "rgba(70,64,82,.55)"; g.fillRect(sx(XL), sy(z), sx(XR) - sx(XL), sy(a) - sy(z));
    const L = [], R = [];
    for (let b = a; b <= z + 1e-6; b += 1/16){ const q = corrAt(b); if (!q) continue; L.push([sx(q.c - q.g/2), sy(b)]); R.push([sx(q.c + q.g/2), sy(b)]); }
    if (L.length > 1){
      g.beginPath(); L.forEach((pt, i) => i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1])); for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]); g.closePath();
      g.fillStyle = "#0a090f"; g.fill(); g.strokeStyle = "rgba(220,215,235,.55)"; g.lineWidth = 1.2; g.stroke();
      g.setLineDash([3, 5]); g.strokeStyle = "rgba(255,255,255,.18)"; g.beginPath();
      for (let b = a, i = 0; b <= z + 1e-6; b += 1/16, i++){ const q = corrAt(b); if (q){ i ? g.lineTo(sx(q.c), sy(b)) : g.moveTo(sx(q.c), sy(b)); } }
      g.stroke(); g.setLineDash([]);
    }
  }
  // walls section: walls, spikes, posts, the hero's hops
  const {S: WS, b1: WB1} = wallSec();
  if (WB1 > bBot && WS.b0 < bTop){
    const yA = sy(Math.min(WB1, bTop + 1)), yB = sy(Math.max(WS.b0, bBot - 1));
    g.fillStyle = "#3a3d46"; g.fillRect(sx(0), yA, sx(XL) - sx(0), yB - yA); g.fillRect(sx(XR), yA, sx(W) - sx(XR), yB - yA);
    for (const o of objs){
      if (o.t === "wspike"){
        const b2 = beatAtY(o.y1), b1 = beatAtY(o.y2); if (b2 < bBot || b1 > bTop) continue;
        const xe = o.side < 0 ? sx(XL) : sx(XR), dir = o.side < 0 ? 1 : -1, yT = sy(b2), yBt = sy(b1);
        g.fillStyle = "rgba(255,45,60,.85)"; g.beginPath(); g.moveTo(xe, yBt);
        for (let y = yBt, k = 0; y > yT; y -= 6, k++) g.lineTo(xe + dir * (k % 2 ? 0 : 8), Math.max(yT, y - 3));
        g.lineTo(xe, yT); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,45,60,.35)"; g.fillRect(o.side < 0 ? xe : xe - 3, yT, 3, yBt - yT);
      } else if (o.t === "isle"){
        const b2 = beatAtY(o.y1), b1 = beatAtY(o.y2); if (b2 < bBot || b1 > bTop) continue;
        g.fillStyle = "#8a8e99"; g.fillRect(sx(W/2) - 4, sy(b2), 8, sy(b1) - sy(b2));
      }
    }
    // hop path
    g.strokeStyle = "rgba(255,200,67,.7)"; g.lineWidth = 2; g.beginPath();
    let side = WS.entry || 1, bPrev = WS.b0; g.moveTo(sx(attachX(side)), sy(bPrev));
    const dB = DASH / SPB;
    for (const d of DOORS){ g.lineTo(sx(attachX(side)), sy(d.b)); side = d.to; g.lineTo(sx(attachX(side)), sy(d.b + dB)); }
    g.lineTo(sx(attachX(side)), sy(WB1)); g.stroke();
  }
  // grid + beat numbers
  const q0 = Math.floor(bBot * 4) / 4;
  g.font = "700 10px Manrope, system-ui, sans-serif"; g.textBaseline = "middle";
  for (let b = q0; b <= bTop; b += 0.25){
    const y = Math.round(sy(b)) + 0.5, whole = Math.abs(b - Math.round(b)) < 1e-6, bar = whole && Math.round(b) % 4 === 0;
    if (!whole && edPPB < 40) continue;
    g.strokeStyle = bar ? "rgba(255,255,255,.22)" : whole ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.035)";
    g.lineWidth = 1; g.beginPath(); g.moveTo(G.lm, y); g.lineTo(w, y); g.stroke();
    if (whole && b >= 0 && (edPPB >= 30 || bar)){ g.fillStyle = bar ? "#efe6d6" : "#6f6878"; g.fillText(String(Math.round(b)), 8, y); }
  }
  // section starts (portals) and finish
  for (let i = 0; i < SECTIONS.length - 1; i++){
    const S = SECTIONS[i]; if (S.b0 > FINISH || S.b0 < bBot - 1 || S.b0 > bTop + 1) continue;
    const y = sy(S.b0);
    g.strokeStyle = S.kind === "end" ? "#ffc843" : S.kind === "mirror" ? "#9a6cff" : S.kind === "drop" ? "#ff2d55" : "#888";
    g.lineWidth = 2; g.beginPath(); g.moveTo(G.lm, y); g.lineTo(w, y); g.stroke();
    g.fillStyle = g.strokeStyle; g.font = "800 10px Manrope, system-ui, sans-serif"; g.fillText(SEC_NAME[S.kind] || "", G.lm + 6, y - 9);
  }
  // taps
  for (const b of MAP.taps){
    if (b < bBot - 0.5 || b > bTop + 0.5) continue;
    const y = sy(b), info = tapX(b), x = sx(info.x), sel = edSel === b;
    if (sel){ g.fillStyle = "rgba(255,45,85,.16)"; g.fillRect(G.lm, y - 9, w - G.lm, 18); }
    g.strokeStyle = sel ? "rgba(255,45,85,.9)" : "rgba(255,255,255,.12)"; g.lineWidth = 1; g.beginPath(); g.moveTo(G.lm, y); g.lineTo(w, y); g.stroke();
    const r = sel ? 8 : 6;
    if (info.post){ g.fillStyle = sel ? "#ff2d55" : "#ffc843"; g.fillRect(x - r, y - r, r * 2, r * 2); }
    else { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = !info.used ? "rgba(255,255,255,.18)" : sel ? "#ff2d55" : "#efe6d6"; g.fill(); }
    g.lineWidth = 1.5; g.strokeStyle = "#07060b"; g.stroke();
    if (MAP.noSpike.includes(b)){ g.strokeStyle = "#5ee08a"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke(); }
  }
  // cursor
  g.strokeStyle = edPlaying ? "#ffc843" : "#ff2d55"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke();
  g.fillStyle = g.strokeStyle; g.beginPath(); g.moveTo(0, cy - 6); g.lineTo(8, cy); g.lineTo(0, cy + 6); g.fill();
  const lbl = "бит " + fmtB(Math.round(edScroll * 8) / 8) + " · " + fmtT(edScroll);
  g.font = "800 11px Manrope, system-ui, sans-serif"; const tw = g.measureText(lbl).width;
  g.fillStyle = "rgba(7,6,11,.85)"; g.fillRect(w - tw - 16, cy + 5, tw + 12, 18); g.fillStyle = g.strokeStyle; g.fillText(lbl, w - tw - 10, cy + 14);
  if (edToastT && performance.now() > edToastT){ edToastT = 0; $("edToast").hidden = true; }
}
function edFrame(){
  if (edPlaying && ac){
    const t = ac.currentTime - startAt; edScroll = (t - PH) / SPB;
    if (edScroll > FINISH + 1.5 || (songBuf && t > songBuf.duration - 0.1)) edStopListen();
  }
  const si = secAt(clamp(edSel !== null ? edSel : edScroll, 0, FINISH - 0.01));
  if (si !== edLastSec){ edLastSec = si; edUI(); }
  edDraw();
}
let edLastSec = -1;

// ---- pointer: drag to scroll, tap to select or add, drag the selected point to move it
edCv.addEventListener("pointerdown", e => {
  e.preventDefault(); try { edCv.setPointerCapture(e.pointerId); } catch(_){}
  const G = edGeom(), r = edCv.getBoundingClientRect(), y = e.clientY - r.top;
  const onSel = edSel !== null && Math.abs(G.sy(edSel) - y) < 14 && !edPlaying;
  edDrag = {y0: y, s0: edScroll, moved: false, move: onSel, b0: edSel};
});
edCv.addEventListener("pointermove", e => {
  if (!edDrag) return;
  const r = edCv.getBoundingClientRect(), y = e.clientY - r.top, dy = y - edDrag.y0;
  if (Math.abs(dy) > 6) edDrag.moved = true;
  if (!edDrag.moved) return;
  if (edDrag.move){
    const nb = Math.round((edDrag.b0 - dy / edPPB) / edSnap) * edSnap;
    edDrag.target = clamp(nb, edSnap, FINISH);
  } else if (!edPlaying) edScroll = clamp(edDrag.s0 + dy / edPPB, -2, FINISH + 2);
});
function edEndDrag(e){
  if (!edDrag) return;
  const d = edDrag; edDrag = null;
  if (d.move && d.moved){ if (d.target !== undefined && d.target !== d.b0) edMoveSel(d.target - d.b0); return; }
  if (d.moved) return;
  const G = edGeom(), r = edCv.getBoundingClientRect(), y = e.clientY - r.top;
  let hitB = null, hd = 13;
  for (const b of MAP.taps){ const dd = Math.abs(G.sy(b) - y); if (dd < hd){ hd = dd; hitB = b; } }
  if (hitB !== null){ edSel = edSel === hitB ? null : hitB; edUI(); return; }
  const b = Math.round(G.bAt(y) / edSnap) * edSnap;
  if (b <= 0 || b > FINISH){ edToast("Прыжки ставятся от начала до финиша"); return; }
  edCommit({...MAP, taps: [...MAP.taps, b]}, b);
}
edCv.addEventListener("pointerup", edEndDrag);
edCv.addEventListener("pointercancel", () => { edDrag = null; });
edCv.addEventListener("wheel", e => { e.preventDefault(); if (!edPlaying) edScroll = clamp(edScroll - e.deltaY / edPPB * 0.6, -2, FINISH + 2); }, {passive: false});

// ---- edits on the selected hop
function edMoveSel(db){
  if (edSel === null) return;
  const nb = Math.round((edSel + db) / edSnap) * edSnap;
  if (nb <= 0 || nb > FINISH){ edToast("Дальше двигать некуда"); return; }
  if (MAP.taps.includes(nb)){ edToast("Там уже есть прыжок"); return; }
  const sw = a => a.map(v => v === edSel ? nb : v);
  edCommit({...MAP, taps: sw(MAP.taps), posts: sw(MAP.posts), noSpike: sw(MAP.noSpike)}, nb);
}
function edTogglePost(){
  if (edSel === null) return;
  const T = wallTaps(MAP), j = T.indexOf(edSel);
  if (MAP.posts.includes(edSel)){ edCommit({...MAP, posts: MAP.posts.filter(v => v !== edSel)}, edSel); return; }
  if (j < 0){ edToast("Столб бывает только в части со стенами"); return; }
  if (j === 0 || j >= T.length - 1){ edToast("На первый и последний прыжок столб не ставится"); return; }
  if (MAP.posts.includes(T[j-1]) || MAP.posts.includes(T[j+1])){ edToast("Два столба подряд нельзя"); return; }
  edCommit({...MAP, posts: [...MAP.posts, edSel]}, edSel);
}
function edToggleSpike(){
  if (edSel === null) return;
  const on = !MAP.noSpike.includes(edSel);
  edCommit({...MAP, noSpike: on ? [...MAP.noSpike, edSel] : MAP.noSpike.filter(v => v !== edSel)}, edSel);
}
function edDelete(){
  if (edSel === null) return;
  const b = edSel, f = a => a.filter(v => v !== b);
  edSel = null; edCommit({...MAP, taps: f(MAP.taps), posts: f(MAP.posts), noSpike: f(MAP.noSpike)});
}

// ---- toolbar state
function edUI(){
  const dirty = edDirty();
  $("edStatus").textContent = dirty ? "есть несохранённые изменения" : (mapKey(MAP) === mapKey(DEFMAP) ? "исходная карта" : "сохранено");
  $("edStatus").className = dirty ? "dirty" : "";
  $("edUndo").disabled = !edHist.length;
  $("edSnap").textContent = "Сетка " + (edSnap === 0.25 ? "1/4" : "1/8");
  $("edListen").textContent = edPlaying ? "■ Стоп" : "▶ Слушать";
  $("edAddNow").hidden = !edPlaying;
  $("edSave").disabled = !dirty;
  const sel = edSel !== null;
  $("edSelRow").hidden = !sel;
  if (sel){
    const inWall = wallTaps(MAP).includes(edSel), post = MAP.posts.includes(edSel), ns = MAP.noSpike.includes(edSel);
    $("edSelLbl").textContent = "бит " + fmtB(edSel);
    $("edPost").hidden = !inWall; $("edSpike").hidden = !inWall;
    $("edPost").textContent = post ? "Столб ✓" : "Столб"; $("edPost").classList.toggle("on", post);
    $("edSpike").textContent = ns ? "Шипы выкл" : "Шипы вкл"; $("edSpike").classList.toggle("on", ns);
  }
  // section controls for the section under the cursor
  const ctl = $("edSecCtl"); ctl.textContent = "";
  const si = secAt(clamp(edSel !== null ? edSel : edScroll, 0, FINISH - 0.01)), S = SECTIONS[si];
  const mk = (txt, fn, lab) => { const bt = document.createElement("button"); bt.className = "chip"; bt.type = "button"; bt.textContent = txt; if (lab) bt.setAttribute("aria-label", lab); bt.addEventListener("click", fn); ctl.appendChild(bt); return bt; };
  const lab = t => { const s2 = document.createElement("small"); s2.textContent = t; ctl.appendChild(s2); };
  const k = WAVE_SECS.indexOf(si);
  if (k >= 0){
    lab((S.kind === "mirror" ? "зеркало" : "волна") + ": коридор " + MAP.G[k]);
    mk("уже", () => { const G2 = MAP.G.slice(); G2[k] = Math.max(64, G2[k] - 8); edCommit({...MAP, G: G2}, edSel); }, "Сделать коридор уже");
    mk("шире", () => { const G2 = MAP.G.slice(); G2[k] = Math.min(220, G2[k] + 8); edCommit({...MAP, G: G2}, edSel); }, "Сделать коридор шире");
  } else if (S.m === "wall"){
    lab("старт на стене");
    const bl = mk("левой", () => edCommit({...MAP, entry: -1}, edSel)), br = mk("правой", () => edCommit({...MAP, entry: 1}, edSel));
    bl.classList.toggle("on", MAP.entry < 0); br.classList.toggle("on", MAP.entry > 0);
  }
}

// ---- save: one document holds the shared map; only the owner can write it
async function edSaveMap(){
  if (!edCanSave || !db){ edToast("Сохранять в общую карту может только владелец. Код карты — в «Ещё»."); return; }
  const m = cleanMap(MAP), body = {taps: m.taps, G: m.G, entry: m.entry, posts: m.posts, noSpike: m.noSpike, ver: mapVer(m), at: Date.now()};
  $("edSave").disabled = true; $("edStatus").textContent = "сохраняю…";
  try { await db.doc("map/lvl1").set(body); savedMap = m; try { store.set(EDKEY, ""); } catch(e){} edToast(body.ver === BASE_LEVEL ? "Сохранено: исходная карта" : "Сохранено. Рекорды на новой карте начинаются заново"); }
  catch(e){ edToast("Не сохранилось" + (e && e.code ? " (" + e.code + ")" : "") + ". Попробуй ещё раз"); }
  edUI();
}

$("edBack").addEventListener("click", closeEditor);
$("edMore").addEventListener("click", () => { const b = $("edMoreBox"); b.hidden = !b.hidden; $("edMore").setAttribute("aria-expanded", String(!b.hidden)); });
$("edReset").addEventListener("click", () => { edSel = null; edCommit(DEFMAP); edToast("Вернул исходную карту. «Отменить» вернёт как было"); });
$("edCodeBtn").addEventListener("click", () => { const bx = $("edCodeBox"); bx.hidden = !bx.hidden; $("edCode").value = "SSMAP1 " + JSON.stringify(cleanMap(MAP)); });
$("edCopy").addEventListener("click", () => { const ta = $("edCode"); ta.value = "SSMAP1 " + JSON.stringify(cleanMap(MAP));
  const fb = () => { ta.focus(); ta.select(); $("edCopy").textContent = "Выделено — скопируй"; };
  try { navigator.clipboard.writeText(ta.value).then(() => $("edCopy").textContent = "Скопировано", fb); } catch(e){ fb(); } });
$("edImport").addEventListener("click", () => {
  const txt = $("edCode").value.trim().replace(/^SSMAP1\s*/, "");
  let m = null; try { m = JSON.parse(txt); } catch(e){}
  if (!m || !Array.isArray(m.taps) || !m.taps.length){ edToast("Код не читается"); return; }
  edSel = null; edCommit(m); edToast("Карта из кода применена");
});
$("edUp").addEventListener("click", () => edMoveSel(edSnap));
$("edDown").addEventListener("click", () => edMoveSel(-edSnap));
$("edPost").addEventListener("click", edTogglePost);
$("edSpike").addEventListener("click", edToggleSpike);
$("edDel").addEventListener("click", edDelete);
$("edUndo").addEventListener("click", () => { if (!edHist.length) return; MAP = edHist.pop(); buildLevel(); if (edSel !== null && !MAP.taps.includes(edSel)) edSel = null; try { store.set(EDKEY, JSON.stringify(MAP)); } catch(e){} edUI(); });
$("edSnap").addEventListener("click", () => { edSnap = edSnap === 0.25 ? 0.125 : 0.25; edUI(); });
$("edZoomIn").addEventListener("click", () => { edPPB = Math.min(160, edPPB * 1.3); });
$("edZoomOut").addEventListener("click", () => { edPPB = Math.max(18, edPPB / 1.3); });
$("edListen").addEventListener("click", edListen);
$("edAddNow").addEventListener("click", edAddNow);
$("edGod").addEventListener("click", () => { godMode = !godMode; $("edGod").textContent = godMode ? "бессмертие вкл" : "бессмертие выкл"; $("edGod").classList.toggle("on", godMode); $("edGod").setAttribute("aria-pressed", String(godMode));
  $("god").textContent = godMode ? "бессмертие вкл" : "бессмертие выкл"; $("god").setAttribute("aria-pressed", String(godMode)); });
$("edPlay").addEventListener("click", () => { const b = Math.max(0, Math.round((edSel !== null ? edSel : edScroll) * 4) / 4); startRun(b < 1.5 ? 0.0001 : b); });
$("edSave").addEventListener("click", edSaveMap);
$("openEd").addEventListener("click", openEditor);
$("toEd").addEventListener("click", backToEditor);
// the editor, track tapping and god mode show up for the artifact's owner (or with #edit in the address)
if (location.hash === "#edit") for (const id of ["openEd", "openTap", "god"]) $(id).hidden = false;
