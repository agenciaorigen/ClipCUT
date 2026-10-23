// ClipCreate Editor — color profesional v1.0 con WebGL2: exposición, contraste, luces, sombras, blancos, negros,
// temperatura, tinte, matiz, saturación, vibrance y LUT 3D. Si el navegador no tiene WebGL2, devuelve null.
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D img; uniform sampler3D lut;
uniform float ex, co, sa, vi, te, ti, hu, hl, sh, wh, bl, mixL, size;
in vec2 uv; out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hue(vec3 c, float a) {
  float s = sin(a), k = cos(a);
  mat3 m = mat3(0.213 + k * 0.787 - s * 0.213, 0.213 - k * 0.213 + s * 0.143, 0.213 - k * 0.213 - s * 0.787,
                0.715 - k * 0.715 - s * 0.715, 0.715 + k * 0.285 + s * 0.140, 0.715 - k * 0.715 + s * 0.715,
                0.072 - k * 0.072 + s * 0.928, 0.072 - k * 0.072 - s * 0.283, 0.072 + k * 0.928 + s * 0.072);
  return m * c;
}
void main() {
  vec4 t = texture(img, uv);
  vec3 c = t.rgb * exp2(ex);
  c *= vec3(1.0 + te * 0.12, 1.0 - ti * 0.08, 1.0 - te * 0.12);
  c = (c - bl * 0.12) / max(0.2, 1.0 - bl * 0.12 - wh * 0.12);   // negros y blancos: dónde empieza y termina
  float l = lum(c);
  c += sh * 0.3 * (1.0 - smoothstep(0.0, 0.55, l)) * (1.0 - l);  // sombras
  c += hl * 0.3 * smoothstep(0.45, 1.0, l) * l;                   // luces
  c = (c - 0.5) * (1.0 + co) + 0.5;
  l = lum(c);
  c = mix(vec3(l), c, 1.0 + sa);
  float s = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(lum(c)), c, 1.0 + vi * (1.0 - clamp(s, 0.0, 1.0)));  // vibrance: sube lo apagado, cuida la piel
  if (hu != 0.0) c = hue(c, hu);
  c = clamp(c, 0.0, 1.0);
  if (mixL > 0.0) c = mix(c, texture(lut, c * ((size - 1.0) / size) + 0.5 / size).rgb, mixL);
  o = vec4(c, t.a);
}`;

let gl = null, cv, tmp, tctx, prog, U = {}, luts = new Map(), failed = false;
function init() {
  if (gl || failed) return gl;
  try {
    cv = new OffscreenCanvas(16, 16);
    gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw 0;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['img', 'lut', 'ex', 'co', 'sa', 'vi', 'te', 'ti', 'hu', 'hl', 'sh', 'wh', 'bl', 'mixL', 'size']) U[k] = gl.getUniformLocation(prog, k);
    gl.uniform1i(U.img, 0); gl.uniform1i(U.lut, 1);
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    tmp = new OffscreenCanvas(16, 16); tctx = tmp.getContext('2d');
  } catch (e) { console.warn('Sin WebGL2: el color avanzado no está disponible.', e); gl = null; failed = true; }
  return gl;
}
export const available = () => !!init();

function lutTex(key, lut) {
  let t = luts.get(key);
  if (t) return t;
  t = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, t);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
  luts.set(key, t); gl.activeTexture(gl.TEXTURE0);
  return t;
}
export const forgetLut = key => { const t = luts.get(key); if (t && gl) gl.deleteTexture(t); luts.delete(key); };

// Corrige el color de un cuadro. paint(ctx, w, h) dibuja la imagen original en un lienzo de w × h.
// Devuelve un lienzo con el resultado (válido hasta la próxima llamada) o null si no hay WebGL2.
export function grade(paint, w, h, p, lut, lutKey) {
  if (!init()) return null;
  const k = Math.min(1, 1920 / Math.max(w, h)); // tope de tamaño: sobra para 1080p
  w = Math.max(2, Math.round(w * k)); h = Math.max(2, Math.round(h * k));
  if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  tctx.clearRect(0, 0, w, h); paint(tctx, w, h);
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
  const set = (n, v) => gl.uniform1f(U[n], v || 0);
  set('ex', p.exp); set('co', p.con); set('sa', p.sat); set('vi', p.vib); set('te', p.temp); set('ti', p.tint);
  set('hu', (p.hue || 0) * Math.PI / 180); set('hl', p.hl); set('sh', p.sh); set('wh', p.wh); set('bl', p.bl);
  if (lut) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, lutTex(lutKey, lut)); gl.activeTexture(gl.TEXTURE0); set('mixL', p.lutMix ?? 1); set('size', lut.size); }
  else set('mixL', 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return cv;
}
