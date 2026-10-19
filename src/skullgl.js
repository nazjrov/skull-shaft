// ---------- the user's Blender skull (GLB: Skull + Jaw), drawn with a tiny WebGL renderer ----------
const SkullGL = (() => {
  // points measured on the model (glTF space, Y up, face toward +Z)
  const CENTER = [0.257, 1.30, -0.30], HINGE = [0.257, 1.32, -0.316];
  const EYES = [[0.043, 1.47, 0.43], [0.461, 1.466, 0.43]];
  const VOIDS = [[0.043, 1.488, 0.30, 0.17, 0.13, 0.12], [0.461, 1.484, 0.30, 0.17, 0.13, 0.12], [0.252, 1.22, 0.40, 0.07, 0.11, 0.10]];
  const VS = `
precision highp float;
attribute vec3 aP; attribute vec3 aN;
uniform mat4 uM, uV, uP;
varying vec3 vN; varying vec3 vVP;
void main(){
  vec4 wp = uM * vec4(aP, 1.0); vec4 vp = uV * wp;
  vVP = vp.xyz; vN = normalize(mat3(uV) * mat3(uM) * aN);
  gl_Position = uP * vp;
}`;
  const FS = `
precision highp float;
uniform float uMode, uRed, uKick, uEye, uDim;
varying vec3 vN; varying vec3 vVP;
void main(){
  if (uMode > 1.5){ gl_FragColor = vec4(vec3(1.0, 0.12, 0.07) * (0.6 + 0.6 * uEye) + vec3(0.5, 0.25, 0.2) * uEye * 0.4, 1.0); return; } // coal
  if (uMode > 0.5){ gl_FragColor = vec4(0.004, 0.0, 0.002, 1.0); return; }                                                         // void
  vec3 n = normalize(vN), v = normalize(vVP);
  if (dot(n, v) > 0.0) n = -n;
  vec3 r = reflect(v, n); float ry = r.y;
  // studio environment: softbox overhead, strip on the side, dark floor with a red bounce
  vec3 env = mix(vec3(0.03), vec3(0.42), smoothstep(-0.4, 0.55, ry));
  env += vec3(1.5) * smoothstep(0.38, 0.55, ry) * smoothstep(0.98, 0.78, ry);
  env += vec3(0.9) * smoothstep(0.10, 0.0, abs(r.x + 0.62)) * smoothstep(-0.3, 0.4, ry);
  env += vec3(0.5) * smoothstep(0.08, 0.0, abs(r.x - 0.7)) * smoothstep(-0.1, 0.5, ry);
  env += vec3(0.3, 0.04, 0.03) * smoothstep(-0.2, -0.8, ry);
  float fres = pow(1.0 - max(dot(n, -v), 0.0), 3.0);
  vec3 c = env * mix(vec3(0.80, 0.81, 0.85), vec3(1.0), fres);
  c += vec3(0.9, 0.08, 0.06) * max(-n.y, 0.0) * 0.14;                      // red underglow
  c = mix(c, c * vec3(1.35, 0.3, 0.3) + vec3(0.1, 0.0, 0.0), uRed * (0.55 + 0.45 * uKick));
  c *= 1.0 - uDim * 0.9;
  gl_FragColor = vec4(c, 1.0);
}`;
  let gl = null, cv = null, prog = null, U = {}, A = {}, ok = false, parts = [], sphere = null, W = 0, H = 0;
  const m4 = {
    id: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
    mul: (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){ let s = 0; for (let k = 0; k < 4; k++) s += a[k*4 + r] * b[c*4 + k]; o[c*4 + r] = s; } return o; },
    t: (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1],
    s: (x, y, z) => [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1],
    rx: a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
    ry: a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
    rz: a => { const c = Math.cos(a), s = Math.sin(a); return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; },
    q: (q) => { const [x, y, z, w] = q; return [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0, 2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0, 2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0, 0,0,0,1]; },
    persp: (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0]; },
    apply: (m, p) => { const x = p[0], y = p[1], z = p[2]; const w = m[3]*x + m[7]*y + m[11]*z + m[15]; return [(m[0]*x + m[4]*y + m[8]*z + m[12]) / w, (m[1]*x + m[5]*y + m[9]*z + m[13]) / w, (m[2]*x + m[6]*y + m[10]*z + m[14]) / w]; }
  };
  function buf(data, target){ const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; }
  function parseGLB(bytes){
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)));
    const binStart = 20 + jl + 8, bin = bytes.subarray(binStart);
    const acc = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], off = (v.byteOffset || 0) + (a.byteOffset || 0);
      const n = a.count * (a.type === "VEC3" ? 3 : 1);
      const src = bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + n * (a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : 2));
      return a.componentType === 5126 ? new Float32Array(src) : a.componentType === 5125 ? new Uint32Array(src) : new Uint16Array(src); };
    return json.nodes.map(nd => {
      const pr = json.meshes[nd.mesh].primitives[0];
      let M = m4.id();
      if (nd.translation) M = m4.mul(M, m4.t(...nd.translation));
      if (nd.rotation) M = m4.mul(M, m4.q(nd.rotation));
      if (nd.scale) M = m4.mul(M, m4.s(...nd.scale));
      return {name: nd.name, M, pos: acc(pr.attributes.POSITION), nrm: acc(pr.attributes.NORMAL), idx: acc(pr.indices)};
    });
  }
  function makeSphere(){
    const P = [], N = [], I = [], S = 14, R = 9;
    for (let j = 0; j <= R; j++) for (let i = 0; i <= S; i++){ const t = j / R * Math.PI, f = i / S * Math.PI * 2; const x = Math.sin(t) * Math.cos(f), y = Math.cos(t), z = Math.sin(t) * Math.sin(f); P.push(x, y, z); N.push(x, y, z); }
    for (let j = 0; j < R; j++) for (let i = 0; i < S; i++){ const a = j * (S + 1) + i, b = a + S + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
    return {vb: buf(new Float32Array(P), gl.ARRAY_BUFFER), nb: buf(new Float32Array(N), gl.ARRAY_BUFFER), ib: buf(new Uint16Array(I), gl.ELEMENT_ARRAY_BUFFER), n: I.length};
  }
  function init(b64){
    try {
      cv = document.createElement("canvas");
      gl = cv.getContext("webgl", {alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true});
      if (!gl) return false;
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      for (const k of ["uM","uV","uP","uMode","uRed","uKick","uEye","uDim"]) U[k] = gl.getUniformLocation(prog, k);
      A.p = gl.getAttribLocation(prog, "aP"); A.n = gl.getAttribLocation(prog, "aN");
      const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      parts = parseGLB(bytes).map(p => ({name: p.name, M: p.M, vb: buf(p.pos, gl.ARRAY_BUFFER), nb: buf(p.nrm, gl.ARRAY_BUFFER), ib: buf(p.idx, gl.ELEMENT_ARRAY_BUFFER), n: p.idx.length}));
      sphere = makeSphere();
      gl.enable(gl.DEPTH_TEST);
      ok = true;
    } catch(e){ console.warn("skull gl", e); ok = false; }
    return ok;
  }
  function drawMesh(m, M, mode){
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
    gl.uniformMatrix4fv(U.uM, false, M); gl.uniform1f(U.uMode, mode);
    gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
  }
  // s: {yaw, pitch, roll, jaw, eye, red, kick, dim}; returns the canvas and where the eyes landed (0..1 of the canvas)
  function render(hPx, s){
    if (!ok) return null;
    const h = Math.max(96, Math.round(hPx / 8) * 8), w = Math.round(h * 0.82 / 2) * 2;
    if (h !== H || w !== W){ H = h; W = w; cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = m4.persp(30 * Math.PI / 180, w / h, 0.5, 30), V = m4.t(0, 0, -6.6);
    gl.uniformMatrix4fv(U.uP, false, P); gl.uniformMatrix4fv(U.uV, false, V);
    gl.uniform1f(U.uRed, s.red || 0); gl.uniform1f(U.uKick, s.kick || 0); gl.uniform1f(U.uEye, s.eye || 0); gl.uniform1f(U.uDim, s.dim || 0);
    // head: rotate around the skull's centre
    let Hd = m4.mul(m4.rz(s.roll || 0), m4.mul(m4.ry(s.yaw || 0), m4.rx(s.pitch || 0)));
    Hd = m4.mul(Hd, m4.t(-CENTER[0], -CENTER[1], -CENTER[2]));
    const J = m4.mul(m4.t(...HINGE), m4.mul(m4.rx(s.jaw || 0), m4.t(-HINGE[0], -HINGE[1], -HINGE[2])));
    for (const p of parts) drawMesh(p, m4.mul(Hd, p.name === "Jaw" ? m4.mul(J, p.M) : p.M), 0);
    for (const v of VOIDS) drawMesh(sphere, m4.mul(Hd, m4.mul(m4.t(v[0], v[1], v[2]), m4.s(v[3], v[4], v[5]))), 1);
    const eyes = [];
    for (const e of EYES){ const M = m4.mul(Hd, m4.mul(m4.t(...e), m4.s(0.042, 0.042, 0.042))); drawMesh(sphere, M, 2);
      const c = m4.apply(m4.mul(P, m4.mul(V, Hd)), e); eyes.push([(c[0] + 1) / 2, (1 - c[1]) / 2]); }
    return {canvas: cv, eyes};
  }
  return { init, render, get ok(){ return ok; } };
})();
