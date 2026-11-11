import { useState, type CSSProperties } from "react";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { customPieces } from "./pieces";
import { PositionEditor } from "./PositionEditor.tsx";
import { ScanBoard } from "./ScanBoard.tsx";
import {
  useGame,
  type ColorChoice,
  type PromotionPiece,
} from "./useGame";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const COLOR_OPTIONS: { value: ColorChoice; label: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "random", label: "Random" },
];

const PROMOTION_OPTIONS: { value: PromotionPiece; label: string }[] = [
  { value: "q", label: "Queen" },
  { value: "r", label: "Rook" },
  { value: "b", label: "Bishop" },
  { value: "n", label: "Knight" },
];

const STRENGTH_NOTES: Record<number, string> = {
  1: "plays like someone on their first lesson.",
  2: "plays like a beginner who knows the rules.",
  3: "plays like a casual player after dinner.",
  4: "plays like a keen improver.",
  5: "plays like a steady club player.",
  6: "plays like a strong club player.",
  7: "plays like a county first board.",
  8: "plays like an expert. Expect few gifts.",
  9: "plays like a master.",
  10: "is Stockfish with nothing held back.",
};

const PIECE_ORDER = ["q", "r", "b", "n", "p"] as const;
const START_COUNT: Record<(typeof PIECE_ORDER)[number], number> = {
  q: 1,
  r: 2,
  b: 2,
  n: 2,
  p: 8,
};
const PIECE_VALUE: Record<(typeof PIECE_ORDER)[number], number> = {
  q: 9,
  r: 5,
  b: 3,
  n: 3,
  p: 1,
};

function readPosition(fen: string) {
  const [placement = "", side = "w", , , , fullmove = "1"] = fen.split(" ");
  const counts: Record<string, number> = {};
  for (const ch of placement) {
    if (/[a-zA-Z]/.test(ch)) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  // Letters list the pieces each side has removed from the board.
  const takenBy = (capturedIsUpper: boolean) =>
    PIECE_ORDER.flatMap((p) => {
      const key = capturedIsUpper ? p.toUpperCase() : p;
      const missing = Math.max(0, START_COUNT[p] - (counts[key] ?? 0));
      return Array.from({ length: missing }, () => p.toUpperCase());
    });
  const whiteTook = takenBy(false);
  const blackTook = takenBy(true);
  const score = (list: string[]) =>
    list.reduce(
      (sum, p) => sum + PIECE_VALUE[p.toLowerCase() as keyof typeof PIECE_VALUE],
      0,
    );
  return {
    sideToMove: side === "b" ? "Black" : "White",
    moveNumber: Number(fullmove) || 1,
    whiteTook,
    blackTook,
    balance: score(whiteTook) - score(blackTook),
  };
}

export function App() {
  const [screen, setScreen] = useState<"home" | "editor" | "scan">("home");
  const [editorInitialFen, setEditorInitialFen] = useState<string | null>(null);

  const {
    fen,
    moveRows,
    colorChoice,
    setColorChoice,
    difficulty,
    setDifficulty,
    orientation,
    flipBoard,
    inCheck,
    checkedKingSquare,
    selectedSquare,
    pendingPromotion,
    selectPromotion,
    cancelPromotion,
    isThinking,
    gameActive,
    statusText,
    resultScore,
    canUndo,
    canResign,
    startGame,
    attemptMove,
    handleSquareClick,
    canDragPiece,
    undo,
    resign,
    playerColor,
    isGameOver,
  } = useGame();

  const position = readPosition(fen);
  const playerName = playerColor === "w" ? "White" : "Black";
  const engineName = playerColor === "w" ? "Black" : "White";

  let statusSentence: string;
  let statusAside: string;
  if (!gameActive) {
    statusSentence = "The board is set. No game is in progress.";
    statusAside = "Choose a side and a strength under III, then begin a new game.";
  } else if (isGameOver && statusText) {
    statusSentence = statusText;
    statusAside = `The game is over after ${moveRows.length} ${
      moveRows.length === 1 ? "move" : "moves"
    }.`;
  } else if (isThinking) {
    statusSentence = `${position.sideToMove} to move. Move ${position.moveNumber}.`;
    statusAside = "Stockfish is considering its reply.";
  } else {
    statusSentence = `${position.sideToMove} to move${
      inCheck ? ", in check" : ""
    }. Move ${position.moveNumber}.`;
    statusAside = pendingPromotion
      ? "Your pawn has reached the last rank. Choose what it becomes."
      : `You have ${playerName}. Stockfish has ${engineName}.`;
  }

  const lastRow = moveRows[moveRows.length - 1];
  const lastMoveCaption = !lastRow
    ? `${position.sideToMove} to play`
    : lastRow.black
      ? `After ${lastRow.n}...${lastRow.black}`
      : `After ${lastRow.n}.${lastRow.white}`;

  const balanceNote =
    position.balance === 0
      ? "Material is level."
      : `${position.balance > 0 ? "White" : "Black"} is ahead by ${Math.abs(
          position.balance,
        )}.`;

  const files = orientation === "white" ? FILES : [...FILES].reverse();
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();

  const squareStyles: Record<string, CSSProperties> = {};
  if (selectedSquare) {
    squareStyles[selectedSquare] = {
      outline: "1px solid var(--ink)",
      outlineOffset: "-1px",
    };
  }
  if (pendingPromotion) {
    squareStyles[pendingPromotion.to] = {
      outline: "1px solid var(--ink)",
      outlineOffset: "-1px",
    };
  }
  if (inCheck && checkedKingSquare) {
    squareStyles[checkedKingSquare] = {
      outline: "1px solid var(--accent)",
      outlineOffset: "-1px",
    };
  }

  return (
    <main className="page">
      <header className="masthead">
        <div className="masthead-title">
          <h1>Snapchess</h1>
          <p className="masthead-dek">
            A board to play on, an engine to play against, and a camera for the
            positions you find in books.
          </p>
        </div>
        <a className="masthead-about" href="/about">
          About
        </a>
      </header>

      {screen === "editor" ? (
        <PositionEditor
          initialFen={editorInitialFen ?? fen}
          colorChoice={colorChoice}
          onColorChoiceChange={setColorChoice}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          onPlayFromHere={(customFen) => {
            setEditorInitialFen(null);
            startGame(customFen);
            setScreen("home");
          }}
          onBack={() => {
            setEditorInitialFen(null);
            setScreen("home");
          }}
        />
      ) : screen === "scan" ? (
        <ScanBoard
          onBackHome={() => setScreen("home")}
          onOpenInEditor={(scannedFen) => {
            setEditorInitialFen(scannedFen);
            setScreen("editor");
          }}
          onPlayFromHere={(scannedFen) => {
            startGame(scannedFen);
            setScreen("home");
          }}
        />
      ) : (
        <div className="stage home-stage">
          <section className="board-column" aria-label="Board">
            <p className="diagram-head" aria-hidden="true">
              <span>Diagram</span>
              <span>{lastMoveCaption}</span>
            </p>
            <div className="diagram">
              <div className="ranks" aria-hidden="true">
                {ranks.map((rank) => (
                  <span key={rank}>{rank}</span>
                ))}
              </div>
              <div className="board-wrap">
                <Chessboard
                  options={{
                    id: "snapchess",
                    position: fen,
                    pieces: customPieces,
                    boardOrientation: orientation,
                    showNotation: false,
                    showAnimations: false,
                    allowDragging: true,
                    allowDragOffBoard: false,
                    allowDrawingArrows: false,
                    animationDurationInMs: 0,
                    boardStyle: {
                      borderRadius: 0,
                      boxShadow: "none",
                      backgroundColor: "transparent",
                    },
                    squareStyle: { borderRadius: 0 },
                    lightSquareStyle: {
                      backgroundColor: "var(--square-light)",
                      borderRadius: 0,
                    },
                    darkSquareStyle: {
                      backgroundColor: "var(--square-dark)",
                      borderRadius: 0,
                    },
                    dropSquareStyle: {
                      boxShadow: "none",
                      outline: "1px solid var(--ink)",
                      outlineOffset: "-1px",
                    },
                    draggingPieceStyle: {
                      transform: "none",
                      borderRadius: 0,
                      boxShadow: "none",
                    },
                    draggingPieceGhostStyle: {
                      borderRadius: 0,
                      boxShadow: "none",
                    },
                    squareStyles,
                    canDragPiece: ({ piece }) => canDragPiece(piece.pieceType),
                    onPieceDrop: ({ sourceSquare, targetSquare }) => {
                      if (!targetSquare) return false;
                      return attemptMove(
                        sourceSquare as Square,
                        targetSquare as Square,
                      );
                    },
                    onSquareClick: ({ square }) => handleSquareClick(square),
                  }}
                />
              </div>
              <div className="files" aria-hidden="true">
                {files.map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            </div>
          </section>
          <aside className="side home-side">
            <section className="folio folio-status" aria-label="Position">
              <h2 className="folio-head">
                <span className="folio-num">I.</span> The position
              </h2>
              <p
                className={`status-line home-status${
                  inCheck && !isGameOver ? " home-status-check" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                {statusSentence}
              </p>
              <p className="home-aside">{statusAside}</p>
              <dl className="material">
                <div>
                  <dt>White has taken</dt>
                  <dd>{position.whiteTook.join(" ") || "nothing"}</dd>
                </div>
                <div>
                  <dt>Black has taken</dt>
                  <dd>{position.blackTook.join(" ") || "nothing"}</dd>
                </div>
              </dl>
              <p className="home-aside home-aside-mono">{balanceNote}</p>

              <div className="controls home-controls">
                <button
                  type="button"
                  className="home-primary"
                  onClick={() => startGame()}
                >
                  New game
                </button>
                <div className="home-secondary">
                  <button type="button" onClick={undo} disabled={!canUndo}>
                    Undo
                  </button>
                  <button type="button" onClick={flipBoard}>
                    Flip board
                  </button>
                  <button type="button" onClick={resign} disabled={!canResign}>
                    Resign
                  </button>
                </div>
              </div>
              {pendingPromotion ? (
                <div className="promotion-bar" aria-label="Promote pawn">
                  <span className="field-label">Promote to</span>
                  <div className="choice-row">
                    {PROMOTION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => selectPromotion(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button type="button" onClick={cancelPromotion}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="folio sheet" aria-label="Score sheet">
              <h2 className="folio-head">
                <span className="folio-num">II.</span> The score
              </h2>
              {moveRows.length > 0 ? (
                <ol className="sheet-list" aria-label="Scoresheet">
                  {moveRows.map((row, index) => {
                    const isLast = index === moveRows.length - 1;
                    return (
                      <li key={row.n}>
                        <span className="sheet-n">{row.n}.</span>
                        <span
                          className={
                            isLast && !row.black ? "sheet-w sheet-last" : "sheet-w"
                          }
                        >
                          {row.white}
                        </span>
                        <span
                          className={
                            isLast && row.black ? "sheet-b sheet-last" : "sheet-b"
                          }
                        >
                          {row.black}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="home-aside">
                  No moves yet. They will be written here as they are played.
                </p>
              )}
              {resultScore ? (
                <p className="result">{resultScore}</p>
              ) : null}
            </section>

            <section className="folio" aria-label="Game setup">
              <h2 className="folio-head">
                <span className="folio-num">III.</span> The terms
              </h2>
              <div className="setup">
                <div className="field">
                  <span className="field-label">Play as</span>
                  <div className="choice-row">
                    {COLOR_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={colorChoice === option.value}
                        onClick={() => setColorChoice(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label" id="strength-label">
                    Strength
                  </span>
                  <div
                    className="difficulty-grid"
                    role="group"
                    aria-labelledby="strength-label"
                  >
                    {DIFFICULTIES.map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={difficulty === level}
                        aria-label={`Difficulty ${level}`}
                        onClick={() => setDifficulty(level)}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <p className="home-aside">
                    At level {difficulty}, the engine {STRENGTH_NOTES[difficulty]}
                  </p>
                </div>
              </div>

            </section>

            <section className="folio" aria-label="Other ways to begin">
              <h2 className="folio-head">
                <span className="folio-num">IV.</span> From elsewhere
              </h2>
              <p className="home-aside">
                Photograph a diagram or a real board and continue from it, or
                place the pieces by hand.
              </p>
              <div className="home-secondary">
                <button type="button" onClick={() => setScreen("scan")}>
                  Scan a board
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorInitialFen(null);
                    setScreen("editor");
                  }}
                >
                  Set up position
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      <footer className="colophon">
        <span>Snapchess</span>
        <span>
          Set in Libre Caslon Text and IBM Plex Mono. Moves by Stockfish,
          figures by chess.js.
        </span>
      </footer>
    </main>
  );
}
