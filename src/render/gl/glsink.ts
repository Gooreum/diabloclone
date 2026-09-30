// WebGL2 월드 그리기: 그림은 1바이트 팔레트 번호(R8) 아틀라스 페이지에 올리고, 셰이더가 색 바꿈 표 → 팔레트로 색을 입힌다.
// 캔버스 수천 개(RGBA) 대신 큰 텍스처 몇 장만 쓰므로 그래픽 메모리가 약 1/4 이고, 브라우저가 캔버스를 하나씩 버리는 일이 없다.
import type { Palette } from '../../formats/palette';
import { BLEND_ALPHA, type DrawOpts, type IndexedImage, type SpriteSink } from '../sink';
import { ShelfAtlas, ShiftRows } from './atlas';
import { FLOATS_PER_VERTEX, QuadBatch } from './batch';

const PAGE = 2048;
const SHIFT_ROWS = 64;

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; in float aRow; in float aBright;
uniform vec2 uSize;
out vec2 vUv; flat out int vRow; out float vBright;
void main() {
  vUv = aUv; vRow = int(aRow); vBright = aBright;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

// 0 = 투명 (기존 2D 그리기와 같은 규칙). 색 = 팔레트[색 바꿈 표[번호]]
const FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas; uniform sampler2D uShift; uniform sampler2D uPal; uniform float uAlpha;
in vec2 vUv; flat in int vRow; in float vBright;
out vec4 o;
void main() {
  int i = int(texelFetch(uAtlas, ivec2(vUv), 0).r * 255.0 + 0.5);
  if (i == 0) discard;
  int j = int(texelFetch(uShift, ivec2(i, vRow), 0).r * 255.0 + 0.5);
  vec3 c = texelFetch(uPal, ivec2(j, 0), 0).rgb;
  o = vec4(min(c * vBright, vec3(1.0)), uAlpha);
}`;

/** 진단용 */
export const glStats = { pages: 0, sprites: 0, uploads: 0, evictions: 0, drawCalls: 0, lost: 0, restored: 0 };

interface GlRes { prog: WebGLProgram; vao: WebGLVertexArrayObject; vbo: WebGLBuffer; pages: WebGLTexture[]; shift: WebGLTexture; pal: WebGLTexture; uSize: WebGLUniformLocation | null; uAlpha: WebGLUniformLocation | null }

export class GlSink implements SpriteSink {
  private readonly gl: WebGL2RenderingContext;
  private res: GlRes | null = null;
  private readonly atlas = new ShelfAtlas(PAGE, 12);
  private readonly shifts = new ShiftRows(SHIFT_ROWS);
  private readonly batch: QuadBatch;
  private pal: Palette | null = null;
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
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const tex = (w: number, h: number, fmt: 'r8' | 'rgba8') => {
      const t = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'r8' ? gl.R8 : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const shift = tex(256, SHIFT_ROWS, 'r8');
    // 0 번 줄 = 항등 표 (색 바꿈 없음)
    const identity = new Uint8Array(256).map((_, i) => i);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, identity);
    const pal = tex(256, 1, 'rgba8');
    this.res = { prog, vao, vbo, pages: [], shift, pal, uSize: gl.getUniformLocation(prog, 'uSize'), uAlpha: gl.getUniformLocation(prog, 'uAlpha') };
    gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uShift'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uPal'), 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shift);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pal);
    if (this.pal) this.uploadPalette(this.pal);
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
    gl.uniform2f(this.res!.uSize, width, height);
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
      }
      row = r.row;
    }
    this.batch.push(slot.page, QuadBatch.normBlend(o?.blend), x, y, img.w, img.h, slot.x, slot.y, row, o?.bright ? 1.6 : 1);
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
    // 근사(원작 미확인): 원작 혼합 표를 GL 혼합으로 근사 — 0~2 = 75/50/25% 불투명, 3(5·6) = 더하기, 4 = 곱하기
    if (blend < 0) {
      gl.disable(gl.BLEND);
      gl.uniform1f(res.uAlpha, 1);
    } else {
      gl.enable(gl.BLEND);
      if (blend <= 2) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(res.uAlpha, BLEND_ALPHA[blend] as number);
      } else {
        gl.uniform1f(res.uAlpha, 1);
        if (blend === 4) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        else gl.blendFunc(gl.ONE, gl.ONE);
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, vertices);
    glStats.drawCalls++;
  }
}
