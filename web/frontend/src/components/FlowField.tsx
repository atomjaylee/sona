import { useEffect, useRef } from 'react'
import { FALLBACK_PALETTE, type RGB } from '../palette'

// 全屏四边形顶点着色器
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

// 片元着色器：用专辑封面主色做「流动的彩色雾团」——分形噪声(fbm)域扭曲，
// 多个随时间游走的色团按距离混合，再柔和色调映射。u_bright 控制整体亮度。
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bright;
uniform vec3 u_c0, u_c1, u_c2, u_c3, u_c4;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
vec3 blob(vec2 uv, vec2 c, vec3 col){
  return col * smoothstep(0.95, 0.0, distance(uv, c));
}
void main(){
  float aspect = u_res.x / u_res.y;
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.x *= aspect;
  float t = u_time * 0.05;
  vec2 q = vec2(fbm(uv*2.2 + t), fbm(uv*2.2 - t + 5.0));
  vec2 w = uv + 0.4 * q;
  vec3 col = vec3(0.0);
  col += blob(w, vec2(0.30*aspect + 0.30*sin(t*1.10),       0.30 + 0.30*cos(t*0.90)), u_c0);
  col += blob(w, vec2(0.70*aspect + 0.30*cos(t*0.80),       0.62 + 0.28*sin(t*1.30)), u_c1);
  col += blob(w, vec2(0.50*aspect + 0.38*sin(t*0.70 + 2.0), 0.42 + 0.30*cos(t*1.10 + 1.0)), u_c2);
  col += blob(w, vec2(0.22*aspect + 0.30*cos(t*1.20 + 1.0), 0.70 + 0.22*sin(t*0.60)), u_c3);
  col += blob(w, vec2(0.80*aspect + 0.30*sin(t*0.90 + 3.0), 0.32 + 0.30*cos(t*0.80 + 2.0)), u_c4);
  col = col / (0.55 + col);   // 柔和色调映射，避免叠加过曝
  col *= u_bright;
  gl_FragColor = vec4(col, 1.0);
}
`

interface FlowFieldProps {
  palette: RGB[]
  /** 整体亮度：歌词面板用高值(~0.85)，全局底色用低值(~0.32)保证可读 */
  brightness?: number
  /** 缓冲区分辨率倍率（模糊画面可用 0.5 省性能） */
  scale?: number
  className?: string
}

export function FlowField({ palette, brightness = 0.82, scale = 1, className }: FlowFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 用 ref 让 rAF 循环读到最新调色板/亮度，而不重启 WebGL
  const paletteRef = useRef<RGB[]>(palette)
  const brightRef = useRef(brightness)
  paletteRef.current = palette && palette.length ? palette : FALLBACK_PALETTE
  brightRef.current = brightness

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uBright = gl.getUniformLocation(prog, 'u_bright')
    const uC = [0, 1, 2, 3, 4].map((i) => gl.getUniformLocation(prog, `u_c${i}`))

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
    }

    let raf = 0
    const start = performance.now()
    const draw = () => {
      resize()
      const cols = paletteRef.current
      gl.uniform1f(uTime, (performance.now() - start) / 1000)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uBright, brightRef.current)
      for (let i = 0; i < 5; i++) {
        const c = cols[i] || FALLBACK_PALETTE[i]
        gl.uniform3f(uC[i], c[0], c[1], c[2])
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [scale])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
