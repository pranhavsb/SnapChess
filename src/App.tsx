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
  } = useGame();

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
        <h1>Snapchess</h1>
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
        <div className="stage">
          <section className="board-column" aria-label="Board">
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
          <aside className="side">
            <div className="setup" aria-label="Game setup">
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
                <span className="field-label">Difficulty</span>
                <div className="difficulty-grid">
                  {DIFFICULTIES.map((level) => (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={difficulty === level}
                      onClick={() => setDifficulty(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="controls">
              <button type="button" onClick={() => startGame()}>
                New game
              </button>
              <button type="button" onClick={undo} disabled={!canUndo}>
                Undo
              </button>
              <button type="button" onClick={flipBoard}>
                Flip board
              </button>
              <button type="button" onClick={resign} disabled={!canResign}>
                Resign
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
              <button type="button" onClick={() => setScreen("scan")}>
                Scan a board
              </button>
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

            {!gameActive ? (
              <p className="status-line">
                Choose side and difficulty, then press new game.
              </p>
            ) : null}
            {isThinking ? <p className="status-line">thinking</p> : null}
            {statusText ? <p className="status-line">{statusText}</p> : null}

            <div className="sheet">
              {moveRows.length > 0 ? (
                <table className="sheet-table" aria-label="Scoresheet">
                  <tbody>
                    {moveRows.map((row) => (
                      <tr key={row.n}>
                        <td>{row.n}.</td>
                        <td>{row.white}</td>
                        <td>{row.black}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {resultScore ? <p className="result">{resultScore}</p> : null}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
