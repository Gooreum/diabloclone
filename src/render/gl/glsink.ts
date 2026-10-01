// WebGL2 월드 그리기: 그림은 1바이트 팔레트 번호(R8) 아틀라스 페이지에 올리고, 셰이더가 색 바꿈 표 → 팔레트로 색을 입힌다.
// 캔버스 수천 개(RGBA) 대신 큰 텍스처 몇 장만 쓰므로 그래픽 메모리가 약 1/4 이고, 브라우저가 캔버스를 하나씩 버리는 일이 없다.
import type { Palette } from '../../formats/palette';
import { BLEND_ALPHA, type DrawOpts, type IndexedImage, type SpriteSink } from '../sink';
import { LIGHT_LEVELS } from '../../formats/pl2';
import { worldToScreen } from '../iso';
import { LIGHTMAP_SIZE, type LightMap } from '../lightmap';
import { ShelfAtlas, ShiftRows } from './atlas';
import { FLOATS_PER_VERTEX, QuadBatch, SHADOW_BLEND } from './batch';

const PAGE = 2048;
const SHIFT_ROWS = 64;

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in float aRow; in float aBright; in vec2 aAnchor;
uniform vec2 uSize;
out vec2 vUv; flat out int vRow; out float vBright; flat out vec2 vAnchor;
void main() {
  vUv = aUv; vRow = int(aRow); vBright = aBright; vAnchor = aAnchor;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

// 0 = 투명 (기존 2D 그리기와 같은 규칙). 색 = 팔레트[밝기 단계 표[밝기][색 바꿈 표[번호]]]
// 밝기: 빛을 재는 화면 점(유닛·벽 = 발밑, 바닥 = 그 픽셀) → 월드 서브타일 → 빛 지도(선형 보간) → 0~31 단계 (원작 PL2 표)
// 그림자: 검정 반투명 (근사(원작 미확인): 원작 그림자 혼합 표 대신 50%)
const FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas; uniform sampler2D uShift; uniform sampler2D uPal; uniform float uAlpha;
uniform sampler2D uLightMap; uniform sampler2D uLightTable;
uniform vec2 uSize; uniform vec2 uCamScreen; uniform vec2 uMapOrigin; uniform float uMapSize; uniform int uLit; uniform int uShadow;
in vec2 vUv; flat in int vRow; in float vBright; flat in vec2 vAnchor;
out vec4 o;
void main() {
  int i = int(texelFetch(uAtlas, ivec2(vUv), 0).r * 255.0 + 0.5);
  if (i == 0) discard;
  if (uShadow == 1) { o = vec4(0.0, 0.0, 0.0, 0.5); return; }
  int j = int(texelFetch(uShift, ivec2(i, vRow), 0).r * 255.0 + 0.5);
  if (uLit == 1) {
    vec2 sp = vAnchor.x < -9000.0 ? vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) : vAnchor;
    vec2 s = sp - uSize * 0.5 + uCamScreen;
    vec2 w = vec2(s.y / 16.0 + s.x / 32.0, s.y / 16.0 - s.x / 32.0) - uMapOrigin;
    int lv = int(texture(uLightMap, w / uMapSize).r * 31.0 + 0.5);
    j = int(texelFetch(uLightTable, ivec2(j, lv), 0).r * 255.0 + 0.5);
  }
  vec3 c = texelFetch(uPal, ivec2(j, 0), 0).rgb;
  o = vec4(min(c * vBright, vec3(1.0)), uAlpha);
}`;

/** 빛 지도가 없을 때: 모두 가장 밝게 */
const FULL_MAP = new Uint8Array(LIGHTMAP_SIZE * LIGHTMAP_SIZE).fill(255);

/** 진단용 */
export const glStats = { pages: 0, sprites: 0, uploads: 0, shiftUploads: 0, evictions: 0, drawCalls: 0, lost: 0, restored: 0, shadows: 0 };

interface GlRes {
  prog: WebGLProgram; vao: WebGLVertexArrayObject; vbo: WebGLBuffer; pages: WebGLTexture[]; shift: WebGLTexture; pal: WebGLTexture;
  lightMap: WebGLTexture; lightTable: WebGLTexture;
  u: Record<'uSize' | 'uAlpha' | 'uCamScreen' | 'uMapOrigin' | 'uMapSize' | 'uLit' | 'uShadow', WebGLUniformLocation | null>;
}

/** 빛이 없을 때 (조명 끔·2D 대체 경로와 같은 밝기): 모든 단계 = 항등 */
const IDENTITY_LIGHT = (() => {
  const t = new Uint8Array(LIGHT_LEVELS * 256);
  for (let r = 0; r < LIGHT_LEVELS; r++) for (let i = 0; i < 256; i++) t[r * 256 + i] = i;
  return t;
})();

export class GlSink implements SpriteSink {
  private readonly gl: WebGL2RenderingContext;
  private res: GlRes | null = null;
  private readonly atlas = new ShelfAtlas(PAGE, 12);
  private readonly shifts = new ShiftRows(SHIFT_ROWS);
  private readonly batch: QuadBatch;
  private pal: Palette | null = null;
  /** 원작 밝기 단계 표 (PL2) · 이번 프레임 빛 지도 (컨텍스트를 되찾으면 다시 올린다) */
  private lightTable: Uint8Array = IDENTITY_LIGHT;
  private lightMap: LightMap | null = null;
  private cam = { x: 0, y: 0 };
  private frame = 0;
  private lost = false;
  private w = 0;
  private h = 0;

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.batch = new QuadBatch((page, blend, data, vertices) => this.drawBatch(page, blend, data, vertices));
    this.init();
  }

  /** WebGL2 를 못 쓰면 null (2D 캔버스로 대체) */
  static create(canvas: HTMLCanvasElement): GlSink | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    let sink: GlSink;
    try {
      sink = new GlSink(gl);
    } catch {
      return null;
    }
    // 브라우저가 그래픽 메모리를 회수하면(contextlost) 그리기를 멈췄다가, 되찾으면(contextrestored) 텍스처를 새로 만든다.
    // 그림 원본(팔레트 번호)은 CPU 에 있으므로 다음 프레임에 보이는 것만 다시 올리면 된다.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      sink.lost = true;
      glStats.lost++;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      glStats.restored++;
      sink.init();
      sink.lost = false;
    });
    return sink;
  }

  private init(): void {
    const gl = this.gl;
    this.atlas.reset();
    this.shifts.reset();
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type) as WebGLShader;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram() as WebGLProgram;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`program: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    const attr = (name: string, size: number, off: number) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    };
    attr('aPos', 2, 0);
    attr('aUv', 2, 2);
    attr('aRow', 1, 4);
    attr('aBright', 1, 5);
    attr('aAnchor', 2, 6);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const tex = (w: number, h: number, fmt: 'r8' | 'rgba8', filter: number = gl.NEAREST) => {
      const t = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'r8' ? gl.R8 : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const shift = tex(256, SHIFT_ROWS, 'r8');
    // 0 번 줄 = 항등 표 (색 바꿈 없음)
    const identity = new Uint8Array(256).map((_, i) => i);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, identity);
    const pal = tex(256, 1, 'rgba8');
    // 빛 지도: 칸 사이를 부드럽게 (선형 보간 — 원작은 서브타일 꼭짓점 밝기를 보간해 그린다)
    const lightMap = tex(LIGHTMAP_SIZE, LIGHTMAP_SIZE, 'r8', gl.LINEAR);
    const lightTable = tex(256, LIGHT_LEVELS, 'r8');
    const u = Object.fromEntries((['uSize', 'uAlpha', 'uCamScreen', 'uMapOrigin', 'uMapSize', 'uLit', 'uShadow'] as const).map((n) => [n, gl.getUniformLocation(prog, n)])) as GlRes['u'];
    this.res = { prog, vao, vbo, pages: [], shift, pal, lightMap, lightTable, u };
    gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uShift'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uPal'), 2);
    gl.uniform1i(gl.getUniformLocation(prog, 'uLightMap'), 3);
    gl.uniform1i(gl.getUniformLocation(prog, 'uLightTable'), 4);
    gl.uniform1f(u.uMapSize, LIGHTMAP_SIZE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shift);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pal);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, lightMap);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, lightTable);
    if (this.pal) this.uploadPalette(this.pal);
    this.uploadLightTable();
    this.uploadLightMap();
  }

  /**
   * 이번 프레임 조명: 빛 지도(없으면 모두 밝게) · 카메라(월드 서브타일) · 원작 밝기 단계 표(PL2, 없으면 그대로).
   * begin() 다음, 그리기 전에 부른다.
   */
  setLight(map: LightMap | null, cam: { x: number; y: number }, table?: Uint8Array | null): void {
    this.batch.flush();
    this.lightMap = map;
    this.cam = { x: cam.x, y: cam.y };
    const t = table ?? IDENTITY_LIGHT;
    const tableChanged = t !== this.lightTable;
    this.lightTable = t;
    if (this.lost) return;
    if (tableChanged) this.uploadLightTable();
    this.uploadLightMap();
  }

  private uploadLightTable(): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.res!.lightTable);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, LIGHT_LEVELS, gl.RED, gl.UNSIGNED_BYTE, this.lightTable);
  }

  private uploadLightMap(): void {
    const gl = this.gl;
    const res = this.res!;
    const m = this.lightMap;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, res.lightMap);
    const data = m?.data ?? FULL_MAP;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LIGHTMAP_SIZE, LIGHTMAP_SIZE, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.useProgram(res.prog);
    gl.uniform2f(res.u.uMapOrigin, m?.originX ?? 0, m?.originY ?? 0);
    const c = worldToScreen(this.cam.x, this.cam.y);
    gl.uniform2f(res.u.uCamScreen, c.x, c.y);
  }

  setPalette(pal: Palette): void {
    if (pal === this.pal) return;
    this.batch.flush();
    this.pal = pal;
    if (!this.lost) this.uploadPalette(pal);
  }

  private uploadPalette(pal: Palette): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.res!.pal);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, pal.subarray(0, 1024));
  }

  begin(width: number, height: number): void {
    this.frame++;
    this.w = width;
    this.h = height;
    if (this.lost || this.gl.isContextLost()) return;
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.res!.prog);
    gl.bindVertexArray(this.res!.vao);
    gl.uniform2f(this.res!.u.uSize, width, height);
  }

  draw(img: IndexedImage, x: number, y: number, o?: DrawOpts): void {
    if (this.lost || img.w <= 0 || img.h <= 0) return;
    // 화면 밖이면 올리지도 않는다
    if (x >= this.w || y >= this.h || x + img.w <= 0 || y + img.h <= 0) return;
    let slot = this.atlas.get(img.id, this.frame);
    if (!slot) {
      const placed = this.atlas.place(img.id, img.w, img.h, this.frame);
      if (!placed) return;
      // 비운 페이지를 참조하는 그리기가 남아 있으면 먼저 끝낸다 (그 자리를 새 그림이 덮기 전에)
      if (placed.evicted !== undefined) {
        this.batch.flush();
        glStats.evictions++;
      }
      slot = placed.slot;
      this.upload(slot.page, slot.x, slot.y, img);
    }
    let row = 0;
    const sh = o?.shift;
    if (sh) {
      const r = this.shifts.row(sh.key, this.frame);
      if (r.fresh) {
        this.batch.flush();
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.res!.shift);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r.row, 256, 1, gl.RED, gl.UNSIGNED_BYTE, sh.map.subarray(0, 256));
        glStats.shiftUploads++;
      }
      row = r.row;
    }
    const blend = o?.shadow ? SHADOW_BLEND : QuadBatch.normBlend(o?.blend);
    if (o?.shadow) glStats.shadows++;
    this.batch.push(slot.page, blend, x, y, img.w, img.h, slot.x, slot.y, row, o?.bright ? 1.6 : (o?.dim ?? 1), o?.lightAt ?? o?.shadow, o?.shadow);
  }

  end(): void {
    if (this.lost) return;
    this.batch.flush();
    glStats.pages = this.atlas.pageCount;
    glStats.sprites = this.atlas.count;
  }

  /** 방금 그린 화면 픽셀 (RGBA, 위쪽 줄부터). 그린 직후 같은 작업 안에서 불러야 한다 */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(this.w * this.h * 4);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // GL 은 아래쪽 줄부터 → 뒤집는다
    const row = this.w * 4;
    const flipped = new Uint8Array(out.length);
    for (let y = 0; y < this.h; y++) flipped.set(out.subarray((this.h - 1 - y) * row, (this.h - y) * row), y * row);
    return flipped;
  }

  /** 테스트용: 컨텍스트를 잃게 했다가 되찾게 한다 */
  debugLoseContext(): { lose: () => void; restore: () => void } | null {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    return ext ? { lose: () => ext.loseContext(), restore: () => ext.restoreContext() } : null;
  }

  private pageTex(p: number): WebGLTexture {
    const res = this.res!;
    let t = res.pages[p];
    if (!t) {
      const gl = this.gl;
      t = gl.createTexture() as WebGLTexture;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, PAGE, PAGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      res.pages[p] = t;
    }
    return t;
  }

  private upload(page: number, x: number, y: number, img: IndexedImage): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pageTex(page));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, img.w, img.h, gl.RED, gl.UNSIGNED_BYTE, img.pixels.subarray(0, img.w * img.h));
    glStats.uploads++;
  }

  private drawBatch(page: number, blend: number, data: Float32Array, vertices: number): void {
    const gl = this.gl;
    const res = this.res!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pageTex(page));
    gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    // 근사(원작 미확인): 원작 혼합 표를 GL 혼합으로 근사 — 0~2 = 75/50/25% 불투명, 3(5·6) = 더하기, 4 = 곱하기, 7 = 그림자
    // 빛나는 것(더하기)은 어둠에 묻히지 않는다 — 조명을 건너뛴다
    gl.uniform1i(res.u.uLit, blend === 3 ? 0 : 1);
    gl.uniform1i(res.u.uShadow, blend === SHADOW_BLEND ? 1 : 0);
    if (blend < 0) {
      gl.disable(gl.BLEND);
      gl.uniform1f(res.u.uAlpha, 1);
    } else {
      gl.enable(gl.BLEND);
      if (blend <= 2 || blend === SHADOW_BLEND) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(res.u.uAlpha, blend === SHADOW_BLEND ? 1 : (BLEND_ALPHA[blend] as number));
      } else {
        gl.uniform1f(res.u.uAlpha, 1);
        if (blend === 4) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        else gl.blendFunc(gl.ONE, gl.ONE);
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, vertices);
    glStats.drawCalls++;
  }
}
