import { useEffect, useRef, useState, type RefObject } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { customPieces } from "../pieces";
import { difficultyToSkillLevel } from "../useGame";
import { homography, lerpQuad, project, UNIT_QUAD, type Quad } from "./homography";
import { SILHOUETTE_PATHS } from "./silhouettes";

type VisualProps = { animate: boolean };

function useInView<T extends Element>(ref: RefObject<T | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: "0px 200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function MiniBoard({ id, fen }: { id: string; fen: string }) {
  return (
    <div className="ab-board">
      <Chessboard
        options={{
          id,
          position: fen,
          pieces: customPieces,
          showNotation: false,
          allowDragging: false,
          allowDrawingArrows: false,
          animationDurationInMs: 260,
          boardStyle: { borderRadius: 0, boxShadow: "none", backgroundColor: "transparent" },
          squareStyle: { borderRadius: 0 },
          lightSquareStyle: { backgroundColor: "var(--square-light)", borderRadius: 0 },
          darkSquareStyle: { backgroundColor: "var(--square-dark)", borderRadius: 0 },
        }}
      />
    </div>
  );
}

const RUY_LOPEZ = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5"];

export function RulesVisual({ animate }: VisualProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [ply, setPly] = useState(animate ? 0 : 6);

  useEffect(() => {
    if (!animate || !inView) return;
    const id = window.setInterval(() => setPly((p) => (p >= RUY_LOPEZ.length ? 0 : p + 1)), 1000);
    return () => window.clearInterval(id);
  }, [animate, inView]);

  const game = new Chess();
  for (const san of RUY_LOPEZ.slice(0, ply)) game.move(san);
  const last = ply > 0 ? RUY_LOPEZ[ply - 1] : "start";

  return (
    <figure className="ab-visual" ref={ref}>
      <MiniBoard id="about-rules" fen={game.fen()} />
      <figcaption>
        <span>chess.js</span> {ply > 0 ? `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."} ${last}` : last}
      </figcaption>
    </figure>
  );
}

// A recorded line played by the real engine, used if the worker cannot start.
const RECORDED = ["d4", "e5", "dxe5", "Nc6", "Nf3", "Qe7", "Bf4", "Qb4+", "Bd2", "Qxb2"];
const WHITE_LEVEL = 10;
const BLACK_LEVEL = 2;

export function EngineVisual({ animate }: VisualProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [fen, setFen] = useState(new Chess().fen());
  const [note, setNote] = useState("waiting");

  useEffect(() => {
    if (!animate || !inView) return;
    let cancelled = false;
    const game = new Chess();
    let recordedIndex = 0;
    let useRecorded = false;

    async function loop() {
      const { getBestMove } = await import("../engine");
      while (!cancelled) {
        if (game.isGameOver() || game.history().length >= 40) {
          await new Promise((r) => setTimeout(r, 1600));
          game.reset();
          recordedIndex = 0;
          if (cancelled) return;
          setFen(game.fen());
        }
        const white = game.turn() === "w";
        const level = white ? WHITE_LEVEL : BLACK_LEVEL;
        const skill = difficultyToSkillLevel(level);
        setNote(`level ${level} / skill ${skill} / thinking 600ms`);
        let played = false;
        if (!useRecorded) {
          try {
            const uci = await Promise.race([
              getBestMove(game.fen(), skill),
              new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000)),
            ]);
            if (cancelled) return;
            game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
            played = true;
          } catch {
            useRecorded = true;
          }
        }
        if (!played) {
          if (recordedIndex >= RECORDED.length) {
            game.reset();
            recordedIndex = 0;
          }
          await new Promise((r) => setTimeout(r, 600));
          if (cancelled) return;
          game.move(RECORDED[recordedIndex]);
          recordedIndex += 1;
          setNote(`replay / level ${level} / skill ${skill}`);
        }
        setFen(game.fen());
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    void loop();
    return () => {
      cancelled = true;
    };
  }, [animate, inView]);

  return (
    <figure className="ab-visual" ref={ref}>
      <MiniBoard id="about-engine" fen={fen} />
      <figcaption>
        <span>stockfish</span> {animate ? note : `level 10 = skill ${difficultyToSkillLevel(10)}`}
      </figcaption>
    </figure>
  );
}

type EditStep = { label: string; apply: (g: Chess) => void };

const EDIT_STEPS: EditStep[] = [
  { label: "empty board, two kings", apply: () => {} },
  { label: "put Q on d1", apply: (g) => g.put({ type: "q", color: "w" }, "d1") },
  { label: "put r on a8", apply: (g) => g.put({ type: "r", color: "b" }, "a8") },
  { label: "put P on e4", apply: (g) => g.put({ type: "p", color: "w" }, "e4") },
  { label: "put p on e5", apply: (g) => g.put({ type: "p", color: "b" }, "e5") },
  { label: "play from here: Qh5", apply: (g) => void g.move("Qh5") },
];
const EDITOR_START = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

export function EditorVisual({ animate }: VisualProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [step, setStep] = useState(animate ? 0 : EDIT_STEPS.length - 2);

  useEffect(() => {
    if (!animate || !inView) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % EDIT_STEPS.length), 1400);
    return () => window.clearInterval(id);
  }, [animate, inView]);

  const fenAt = (n: number) => {
    const g = new Chess(EDITOR_START);
    for (let i = 0; i <= n; i += 1) EDIT_STEPS[i].apply(g);
    return g.fen();
  };
  const fen = fenAt(step);
  const prev = step > 0 ? fenAt(step - 1) : fen;
  const ranks = fen.split(" ")[0].split("/");
  const prevRanks = prev.split(" ")[0].split("/");
  const rest = fen.split(" ").slice(1).join(" ");

  return (
    <figure className="ab-visual" ref={ref}>
      <MiniBoard id="about-editor" fen={fen} />
      <code className="ab-fen" aria-label={`FEN: ${fen}`}>
        {ranks.map((r, i) => (
          <span key={i}>
            <span className={r !== prevRanks[i] ? "ab-fen-changed" : undefined}>{r}</span>
            {i < 7 ? "/" : " "}
          </span>
        ))}
        {rest}
      </code>
      <figcaption>
        <span>editor</span> {EDIT_STEPS[step].label}
      </figcaption>
    </figure>
  );
}

function useCanvasLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  run: boolean,
  draw: (ctx: CanvasRenderingContext2D, size: number, t: number) => void,
  periodMs: number,
  staticT: number,
) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!run) {
      drawRef.current(ctx, size, staticT);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (!document.hidden) drawRef.current(ctx, size, ((now - start) % periodMs) / periodMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, run, periodMs, staticT]);
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

const LIGHT = "#E4D9BE";
const DARK = "#8A7B55";
const INK = "#151515";
const ACCENT = "#B3261E";

export function ScannerVisual({ animate }: VisualProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref);

  useCanvasLoop(
    ref,
    animate && inView,
    (ctx, size, t) => {
      ctx.clearRect(0, 0, size, size);
      const s = size;
      // Photo of a board shot from the side: a skewed quad.
      const photo: Quad = [
        { x: s * 0.3, y: s * 0.2 },
        { x: s * 0.84, y: s * 0.27 },
        { x: s * 0.94, y: s * 0.8 },
        { x: s * 0.06, y: s * 0.7 },
      ];
      const margin = s * 0.1;
      const flat: Quad = [
        { x: margin, y: margin },
        { x: s - margin, y: margin },
        { x: s - margin, y: s - margin },
        { x: margin, y: s - margin },
      ];
      const u = ease(clamp01((t - 0.42) / 0.3));
      const quad = lerpQuad(photo, flat, u);
      const h = homography(UNIT_QUAD, quad);
      for (let j = 0; j < 8; j += 1) {
        for (let i = 0; i < 8; i += 1) {
          const a = project(h, { x: i / 8, y: j / 8 });
          const b = project(h, { x: (i + 1) / 8, y: j / 8 });
          const c = project(h, { x: (i + 1) / 8, y: (j + 1) / 8 });
          const d = project(h, { x: i / 8, y: (j + 1) / 8 });
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.lineTo(d.x, d.y);
          ctx.closePath();
          ctx.fillStyle = (i + j) % 2 ? DARK : LIGHT;
          ctx.fill();
        }
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = INK;
      // Four taps, one after another, before the flatten.
      const tapsShown = u > 0 ? 4 : Math.floor(clamp01(t / 0.4) * 5);
      for (let k = 0; k < Math.min(4, tapsShown); k += 1) {
        const p = quad[k];
        ctx.strokeStyle = ACCENT;
        ctx.strokeRect(p.x - 5.5, p.y - 5.5, 11, 11);
        ctx.fillStyle = ACCENT;
        ctx.fillText(String(k + 1), p.x + 9, p.y - 7);
      }
      ctx.fillStyle = INK;
      ctx.fillText(u >= 1 ? "1000 x 1000, warpPerspective" : u > 0 ? "flattening" : "tap the four corners", 8, s - 10);
    },
    5200,
    1,
  );

  return (
    <figure className="ab-visual">
      <canvas ref={ref} className="ab-canvas" aria-hidden="true" />
      <figcaption>
        <span>opencv.js</span> four taps, one homography
      </figcaption>
    </figure>
  );
}

export function ClassifierVisual({ animate }: VisualProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref);
  const pawn = useRef<Path2D | null>(null);

  useCanvasLoop(
    ref,
    animate && inView,
    (ctx, size, t) => {
      pawn.current ??= new Path2D(SILHOUETTE_PATHS[0]);
      ctx.clearRect(0, 0, size, size);
      const k = size / 1000;
      // 1000x1000 flattened board, 100px margin, 100px squares.
      ctx.fillStyle = "rgba(21,21,21,0.04)";
      ctx.fillRect(0, 0, size, size);
      for (let r = 0; r < 8; r += 1) {
        for (let f = 0; f < 8; f += 1) {
          ctx.fillStyle = (r + f) % 2 ? DARK : LIGHT;
          ctx.fillRect((100 + f * 100) * k, (100 + r * 100) * k, 100 * k + 0.5, 100 * k + 0.5);
        }
      }
      // A pawn on e4 photographed from the front leans into e5.
      const sq = { x: 100 + 4 * 100, y: 100 + 4 * 100 };
      ctx.save();
      ctx.translate((sq.x + 12) * k, (sq.y - 70) * k);
      ctx.scale((76 * k) / 100, (160 * k) / 100);
      ctx.fillStyle = "rgba(21,21,21,0.82)";
      ctx.fill(pawn.current);
      ctx.restore();

      const showTall = t > 0.5;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.strokeRect(sq.x * k, sq.y * k, 100 * k, 100 * k);
      ctx.font = "11px 'IBM Plex Mono', monospace";
      if (showTall) {
        const a = ease(clamp01((t - 0.5) / 0.2));
        const top = sq.y - 120 * a;
        ctx.strokeStyle = ACCENT;
        ctx.strokeRect((sq.x - 15) * k, top * k, 130 * k, (sq.y + 110 - top) * k);
        ctx.fillStyle = ACCENT;
        ctx.fillText("tall crop 130 x 230", 8, 14);
      } else {
        ctx.fillStyle = INK;
        ctx.fillText("square crop 100 x 100: half a pawn", 8, 14);
      }
    },
    4800,
    0.9,
  );

  return (
    <figure className="ab-visual">
      <canvas ref={ref} className="ab-canvas" aria-hidden="true" />
      <figcaption>
        <span>mobilenetv3</span> what the model is shown
      </figcaption>
    </figure>
  );
}

export function NextVisual({ animate }: VisualProps) {
  return (
    <figure className="ab-visual ab-next">
      <pre className="ab-todo">
        {"[ ] scan from two or three angles\n[ ] retrain on labelled corrections\n[x] keep the scanner honest about\n    what it is unsure of"}
        <span className={animate ? "ab-caret ab-caret-blink" : "ab-caret"} aria-hidden="true">
          _
        </span>
      </pre>
      <figcaption>
        <span>todo.txt</span> not built yet
      </figcaption>
    </figure>
  );
}
