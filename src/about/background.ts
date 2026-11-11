import { homography, project, type Matrix3, type Quad } from "./homography";
import { SILHOUETTE_PATHS } from "./silhouettes";

export type BackgroundControls = {
  /** Field rotation in radians. */
  rotate: number;
  /** 0 = flat, ~0.5 = strongly receding top edge. */
  tilt: number;
  /** Extra sideways shift in CSS px, driven by scroll. */
  shift: number;
  /** 0..1, collapses rotation and tilt to a flat top-down square. */
  unwarp: number;
};

type Ghost = {
  path: Path2D;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  speed: number;
};

const INK = "21, 21, 21";
const WALNUT = "138, 123, 85";

export function startBackground(canvas: HTMLCanvasElement, lowPower: boolean) {
  const ctx = canvas.getContext("2d");
  const controls: BackgroundControls = { rotate: 0, tilt: 0.08, shift: 0, unwarp: 0 };
  if (!ctx) return { controls, destroy: () => {} };

  const dpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const cell = lowPower ? 104 : 76;
  const paths = SILHOUETTE_PATHS.map((d) => new Path2D(d));

  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let base: Float32Array = new Float32Array(0);
  let off: Float32Array = new Float32Array(0);
  let vel: Float32Array = new Float32Array(0);
  let screen: Float32Array = new Float32Array(0);
  const mouse = { x: -9999, y: -9999, active: false };
  const ghosts: Ghost[] = [];
  let raf = 0;
  let last = performance.now();
  let drift = 0;
  let dirty = true;
  let lastKey = "";

  function seeded(i: number) {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const span = Math.hypot(width, height) * 1.5;
    cols = Math.ceil(span / cell) + 3;
    rows = Math.ceil(span / cell) + 3;
    const n = (cols + 1) * (rows + 1);
    base = new Float32Array(n * 2);
    off = new Float32Array(n * 2);
    vel = new Float32Array(n * 2);
    screen = new Float32Array(n * 2);
    for (let j = 0; j <= rows; j += 1) {
      for (let i = 0; i <= cols; i += 1) {
        const k = j * (cols + 1) + i;
        const edge = i === 0 || j === 0 || i === cols || j === rows;
        const jx = edge ? 0 : (seeded(k) - 0.5) * cell * 0.22;
        const jy = edge ? 0 : (seeded(k + 9999) - 0.5) * cell * 0.22;
        base[k * 2] = (i - cols / 2) * cell + jx;
        base[k * 2 + 1] = (j - rows / 2) * cell + jy;
      }
    }
    dirty = true;
  }

  function fieldMatrix(): Matrix3 {
    const u = controls.unwarp;
    const angle = controls.rotate * (1 - u);
    const tilt = controls.tilt * (1 - u);
    const half = Math.max(width, height) * 0.5;
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ].map(([x, y], idx) => {
      const squeeze = idx < 2 ? 1 - tilt : 1 + tilt * 0.35;
      const sx = x * squeeze;
      const sy = y * (1 - tilt * 0.3);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      return { x: width / 2 + sx * c - sy * s, y: height / 2 + sx * s + sy * c };
    }) as Quad;
    const src: Quad = [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ];
    return homography(src, corners);
  }

  function spawnGhost(): Ghost {
    const size = 140 + Math.random() * 160;
    const fromLeft = Math.random() < 0.5;
    return {
      path: paths[Math.floor(Math.random() * paths.length)],
      x: fromLeft ? Math.random() * width * 0.5 : width * 0.5 + Math.random() * width * 0.4,
      y: Math.random() * (height - size),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 8),
      vy: (Math.random() - 0.5) * 4,
      size,
      life: 0,
      speed: 1 / (9 + Math.random() * 6),
    };
  }

  function step(dt: number) {
    drift += dt * 7;
    const shiftTotal = drift + controls.shift;
    const period = cell * 2;
    const dx = ((shiftTotal % period) + period) % period;
    const dy = ((drift * 0.4) % period + period) % period;
    const h = fieldMatrix();
    const n = screen.length / 2;
    const radius = 180;
    for (let k = 0; k < n; k += 1) {
      const p = project(h, { x: base[k * 2] + dx - cell, y: base[k * 2 + 1] + dy - cell });
      if (!lowPower) {
        let tx = 0;
        let ty = 0;
        if (mouse.active) {
          const mx = p.x - mouse.x;
          const my = p.y - mouse.y;
          const d = Math.hypot(mx, my);
          if (d < radius && d > 0.01) {
            const f = (1 - d / radius) ** 2 * 34;
            tx = (mx / d) * f;
            ty = (my / d) * f;
          }
        }
        const ax = (tx - off[k * 2]) * 0.09;
        const ay = (ty - off[k * 2 + 1]) * 0.09;
        vel[k * 2] = (vel[k * 2] + ax) * 0.8;
        vel[k * 2 + 1] = (vel[k * 2 + 1] + ay) * 0.8;
        off[k * 2] += vel[k * 2];
        off[k * 2 + 1] += vel[k * 2 + 1];
      }
      screen[k * 2] = p.x + off[k * 2];
      screen[k * 2 + 1] = p.y + off[k * 2 + 1];
    }

    if (!lowPower) {
      while (ghosts.length < 3) ghosts.push(spawnGhost());
      for (let g = ghosts.length - 1; g >= 0; g -= 1) {
        const ghost = ghosts[g];
        ghost.life += dt * ghost.speed;
        ghost.x += ghost.vx * dt;
        ghost.y += ghost.vy * dt;
        if (ghost.life >= 1) ghosts.splice(g, 1);
      }
    }
  }

  function draw() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const stride = cols + 1;
    const dark = new Path2D();
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if ((i + j) % 2 === 0) continue;
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride + 1;
        const d = a + stride;
        dark.moveTo(screen[a * 2], screen[a * 2 + 1]);
        dark.lineTo(screen[b * 2], screen[b * 2 + 1]);
        dark.lineTo(screen[c * 2], screen[c * 2 + 1]);
        dark.lineTo(screen[d * 2], screen[d * 2 + 1]);
        dark.closePath();
      }
    }
    ctx!.fillStyle = `rgba(${WALNUT}, 0.085)`;
    ctx!.fill(dark);

    const lines = new Path2D();
    for (let j = 0; j <= rows; j += 1) {
      lines.moveTo(screen[j * stride * 2], screen[j * stride * 2 + 1]);
      for (let i = 1; i <= cols; i += 1) {
        const k = j * stride + i;
        lines.lineTo(screen[k * 2], screen[k * 2 + 1]);
      }
    }
    for (let i = 0; i <= cols; i += 1) {
      lines.moveTo(screen[i * 2], screen[i * 2 + 1]);
      for (let j = 1; j <= rows; j += 1) {
        const k = j * stride + i;
        lines.lineTo(screen[k * 2], screen[k * 2 + 1]);
      }
    }
    ctx!.strokeStyle = `rgba(${INK}, 0.07)`;
    ctx!.lineWidth = 1;
    ctx!.stroke(lines);

    for (const ghost of ghosts) {
      const alpha = Math.sin(Math.PI * ghost.life) * 0.06;
      ctx!.setTransform(
        (dpr * ghost.size) / 100,
        0,
        0,
        (dpr * ghost.size) / 100,
        ghost.x * dpr,
        ghost.y * dpr,
      );
      ctx!.fillStyle = `rgba(${INK}, ${alpha.toFixed(4)})`;
      ctx!.fill(ghost.path);
    }
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (lowPower) {
      const key = `${controls.rotate}|${controls.tilt}|${controls.shift}|${controls.unwarp}`;
      if (dirty || key !== lastKey) {
        lastKey = key;
        dirty = false;
        step(0);
        draw();
      }
    } else {
      step(dt);
      draw();
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) cancelAnimationFrame(raf);
    else start();
  }

  function onMove(event: PointerEvent) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.active = event.pointerType === "mouse";
  }

  function onLeave() {
    mouse.active = false;
  }

  resize();
  start();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);

  return {
    controls,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    },
  };
}
