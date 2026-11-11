import { useEffect, useRef, useState, type ReactNode } from "react";
import "./about.css";
import {
  ClassifierVisual,
  EditorVisual,
  EngineVisual,
  NextVisual,
  RulesVisual,
  ScannerVisual,
} from "./visuals";

type Stop = {
  n: string;
  title: string;
  body: string[];
  Visual: (props: { animate: boolean }) => ReactNode;
};

const STOPS: Stop[] = [
  {
    n: "01",
    title: "Board and rules",
    body: [
      "React on Vite. chess.js decides what is legal; react-chessboard draws it.",
      "The pieces are the Cburnett set, the squares are two flat colours, and nothing has rounded corners.",
    ],
    Visual: RulesVisual,
  },
  {
    n: "02",
    title: "Playing the computer",
    body: [
      "Stockfish runs as a WASM worker in the browser. The ten difficulty levels map onto its Skill Level from 0 to 20.",
      "It gets 600ms per move at every level. The board on the right is the real engine, playing itself.",
    ],
    Visual: EngineVisual,
  },
  {
    n: "03",
    title: "Position editor",
    body: [
      "FEN in, FEN out. Place pieces by hand or paste a string, and the other one keeps up.",
      "When the position looks right, play from here.",
    ],
    Visual: EditorVisual,
  },
  {
    n: "04",
    title: "Scanner",
    body: [
      "Take a photo, tap the four corners of the board.",
      "OpenCV.js computes the perspective transform and flattens it to a 1000 × 1000 top-down board with a margin round the edge.",
    ],
    Visual: ScannerVisual,
  },
  {
    n: "05",
    title: "Classifier",
    body: [
      "A MobileNetV3, trained on Colab on the ChessReD dataset, labels each of the 64 squares. ChessReD is one board and one piece set, so the first version scored about 98% there and fell apart on other boards.",
      "On angled photos, tall pieces also lean into the square behind them, so the model saw half a piece in two squares. Labelled user corrections and taller, asymmetric crops fix it.",
    ],
    Visual: ClassifierVisual,
  },
  {
    n: "06",
    title: "What's next",
    body: [
      "Scanning from more than one angle, so a piece hidden in one photo shows up in another.",
      "Learning from the corrections people make, instead of me relabelling by hand.",
    ],
    Visual: NextVisual,
  },
];

const COLOPHON: [string, string][] = [
  ["Interface", "React, TypeScript"],
  ["Build", "Vite"],
  ["Rules", "chess.js"],
  ["Board", "react-chessboard"],
  ["Engine", "Stockfish (WASM)"],
  ["Vision", "OpenCV.js"],
  ["Inference", "ONNX Runtime Web"],
  ["Training", "PyTorch on Google Colab"],
  ["Data", "Supabase"],
  ["Hosting", "Vercel"],
  ["Written with", "Cursor and Claude"],
  ["Type", "Fraunces, IBM Plex Mono"],
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isLowPower() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (
    (navigator.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    window.innerWidth <= 900
  );
}

function Photo() {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  return (
    <div className="ab-photo" data-state={state}>
      {state !== "failed" ? (
        <img
          src="/pranhav.jpg"
          alt="Pranhav, the person who built Snapchess"
          width={480}
          height={600}
          onLoad={() => setState("ok")}
          onError={() => setState("failed")}
        />
      ) : (
        <div className="ab-photo-empty" role="img" aria-label="Photo of Pranhav, not available">
          <span aria-hidden="true">photo</span>
        </div>
      )}
    </div>
  );
}

export function AboutPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reduced] = useState(prefersReducedMotion);
  const [intro, setIntro] = useState(!reduced);

  useEffect(() => {
    document.title = "About / Snapchess";
    const root = rootRef.current;
    if (!root || reduced) return;
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void import("./motion").then(({ initMotion }) => {
      if (disposed) return;
      cleanup = initMotion(root, {
        canvas: canvasRef.current,
        lowPower: isLowPower(),
        onIntroDone: () => setIntro(false),
      });
    });
    return () => {
      disposed = true;
      cleanup?.();
      document.title = "Snapchess";
    };
  }, [reduced]);

  return (
    <div className={reduced ? "about is-reduced" : "about"} ref={rootRef}>
      {!reduced && <canvas className="ab-bg" ref={canvasRef} aria-hidden="true" />}
      <svg className="ab-grain" aria-hidden="true" focusable="false">
        <filter id="ab-grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0 0.08  0 0 0 0.55 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#ab-grain-filter)" />
      </svg>
      {!reduced && <div className="ab-reticle" aria-hidden="true" />}
      {intro && (
        <div className="ab-intro" data-intro>
          <div className="ab-intro-grid" aria-hidden="true">
            {Array.from({ length: 64 }, (_, i) => (
              <span key={i} className={(Math.floor(i / 8) + i) % 2 ? "d" : "l"} />
            ))}
          </div>
          <button type="button" className="ab-intro-skip" data-intro-skip>
            Skip intro
          </button>
        </div>
      )}

      <header className="ab-top">
        <a className="ab-link ab-home" href="/">
          Snapchess
        </a>
        <span className="ab-top-label">About, and how it was built</span>
      </header>

      <main id="about-main">
        <section className="ab-hero" aria-labelledby="ab-hero-title">
          <p className="ab-vlabel" aria-hidden="true">
            Notes / 2026
          </p>
          <h1 id="ab-hero-title" className="ab-hero-title">
            <span className="ab-line"><span>Snapchess started</span></span>
            <span className="ab-line"><span>as a problem I had:</span></span>
            <span className="ab-line ab-line-off"><span>a real board,</span></span>
            <span className="ab-line"><span>an online game I wanted</span></span>
            <span className="ab-line ab-line-accent"><span>to keep playing.</span></span>
          </h1>
          <p className="ab-hero-aside" data-reveal="aside">
            This page is the build log. Six stops, in the order they happened, each with a small working piece of the
            real thing next to it.
          </p>
        </section>

        <section className="ab-timeline" aria-labelledby="ab-timeline-title">
          <div className="ab-pin">
            <h2 id="ab-timeline-title" className="ab-timeline-title">
              <span className="ab-line"><span>How it was built</span></span>
            </h2>
            <ol className="ab-track">
              {STOPS.map(({ n, title, body, Visual }, i) => (
                <li className={`ab-stop ab-stop-${i + 1}`} key={n} data-stop={i}>
                  <div className="ab-numeral" aria-hidden="true" data-numeral={n}>
                    {n.split("").map((d, k) => (
                      <span key={k}>{d}</span>
                    ))}
                  </div>
                  <div className="ab-stop-text">
                    <h3>
                      <span className="ab-visually-hidden">{`Stop ${i + 1}: `}</span>
                      {title}
                    </h3>
                    {body.map((p, k) => (
                      <p key={k} data-reveal="body">
                        {p}
                      </p>
                    ))}
                  </div>
                  <Visual animate={!reduced} />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="ab-colophon" aria-labelledby="ab-colophon-title">
          <h2 id="ab-colophon-title" className="ab-vlabel-h">
            Colophon
          </h2>
          <dl>
            {COLOPHON.map(([k, v]) => (
              <div key={k} data-reveal="row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ab-me" aria-labelledby="ab-me-title">
          <Photo />
          <div className="ab-me-text">
            <h2 id="ab-me-title" className="ab-me-title">
              <span className="ab-line"><span>Who made it</span></span>
            </h2>
            <p data-reveal="body">
              I'm Pranhav. I study computer science and economics at NYU Abu Dhabi. I like building things that start
              from a real-world problem, like asking 100+ farmers how they irrigate before writing any code. Snapchess
              is the same habit, pointed at a chessboard.
            </p>
          </div>
        </section>

        <section className="ab-contact" aria-labelledby="ab-contact-title">
          <h2 id="ab-contact-title" className="ab-contact-title">
            <span className="ab-line"><span>Building in fintech,</span></span>
            <span className="ab-line"><span>agritech or AI?</span></span>
            <span className="ab-line ab-line-accent"><span>Say hi.</span></span>
          </h2>
          <ul className="ab-contact-links">
            <li>
              <a className="ab-link" href="mailto:ps5914@nyu.edu">
                <span className="ab-link-label">Email</span> ps5914@nyu.edu
              </a>
            </li>
            <li>
              <a className="ab-link" href="https://linkedin.com/in/pranhav" target="_blank" rel="noopener noreferrer">
                <span className="ab-link-label">LinkedIn</span> /in/pranhav
                <span className="ab-visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
            <li>
              <a className="ab-link ab-link-back" href="/">
                <span className="ab-link-label">Return</span> Back to the board
              </a>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
