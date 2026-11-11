import { useState } from "react";
import type { Color, Square } from "chess.js";
import {
  Chessboard,
  ChessboardProvider,
  SparePiece,
  type PieceDropHandlerArgs,
} from "react-chessboard";
import { customPieces } from "./pieces";
import {
  buildFen,
  parseFenToEditor,
  STARTING_FEN,
  validateEditorPosition,
  type BoardMap,
  type CastlingRights,
  type PieceCode,
} from "./fenValidator";
import type { ColorChoice } from "./useGame";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const DIFFICULTIES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const WHITE_PIECES: { code: PieceCode; label: string }[] = [
  { code: "wK", label: "White king" },
  { code: "wQ", label: "White queen" },
  { code: "wR", label: "White rook" },
  { code: "wB", label: "White bishop" },
  { code: "wN", label: "White knight" },
  { code: "wP", label: "White pawn" },
];

const BLACK_PIECES: { code: PieceCode; label: string }[] = [
  { code: "bK", label: "Black king" },
  { code: "bQ", label: "Black queen" },
  { code: "bR", label: "Black rook" },
  { code: "bB", label: "Black bishop" },
  { code: "bN", label: "Black knight" },
  { code: "bP", label: "Black pawn" },
];

const COLOR_OPTIONS: { value: ColorChoice; label: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "random", label: "Random" },
];

type ToolSelection = PieceCode | "remove" | null;

type PositionEditorProps = {
  initialFen?: string;
  colorChoice: ColorChoice;
  onColorChoiceChange: (choice: ColorChoice) => void;
  difficulty: number;
  onDifficultyChange: (level: number) => void;
  onPlayFromHere: (fen: string) => void;
  onBack: () => void;
};

export function PositionEditor({
  initialFen = STARTING_FEN,
  colorChoice,
  onColorChoiceChange,
  difficulty,
  onDifficultyChange,
  onPlayFromHere,
  onBack,
}: PositionEditorProps) {
  const initialParsed =
    parseFenToEditor(initialFen) ?? parseFenToEditor(STARTING_FEN)!;

  const [board, setBoard] = useState<BoardMap>(() => initialParsed.board);
  const [turn, setTurn] = useState<Color>(() => initialParsed.settings.turn);
  const [castling, setCastling] = useState<CastlingRights>(
    () => initialParsed.settings.castling,
  );
  const [tool, setTool] = useState<ToolSelection>("wP");
  const [fenInput, setFenInput] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const settings = { turn, castling };
  const currentFen = buildFen(board, settings);
  const validation = validateEditorPosition(board, settings);

  function handleSquareClick(square: string) {
    const sq = square as Square;
    setLoadError(null);

    if (tool === "remove") {
      if (!board[sq]) return;
      setBoard((prev) => {
        const next = { ...prev };
        delete next[sq];
        return next;
      });
      return;
    }

    if (tool) {
      setBoard((prev) => ({
        ...prev,
        [sq]: tool,
      }));
    }
  }

  function handlePieceDrop({
    piece,
    sourceSquare,
    targetSquare,
  }: PieceDropHandlerArgs): boolean {
    setLoadError(null);
    const pieceCode = piece.pieceType as PieceCode;

    if (!targetSquare) {
      if (!piece.isSparePiece) {
        const from = sourceSquare as Square;
        setBoard((prev) => {
          const next = { ...prev };
          delete next[from];
          return next;
        });
        return true;
      }
      return false;
    }

    const to = targetSquare as Square;
    setBoard((prev) => {
      const next = { ...prev };
      if (!piece.isSparePiece) {
        delete next[sourceSquare as Square];
      }
      next[to] = pieceCode;
      return next;
    });
    return true;
  }

  function handleClearBoard() {
    setLoadError(null);
    setBoard({});
    setCastling({ wK: false, wQ: false, bK: false, bQ: false });
  }

  function handleStartingPosition() {
    setLoadError(null);
    const parsed = parseFenToEditor(STARTING_FEN)!;
    setBoard(parsed.board);
    setTurn(parsed.settings.turn);
    setCastling(parsed.settings.castling);
  }

  function handleToggleCastling(key: keyof CastlingRights) {
    setLoadError(null);
    setCastling((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function handleLoadFen() {
    const parsed = parseFenToEditor(fenInput);
    if (!parsed) {
      setLoadError("Could not parse FEN string.");
      return;
    }
    setLoadError(null);
    setBoard(parsed.board);
    setTurn(parsed.settings.turn);
    setCastling(parsed.settings.castling);
  }

  function handleCopyFen() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(currentFen).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
    }
  }

  return (
    <ChessboardProvider
      options={{
        id: "snapchess-editor",
        position: currentFen,
        pieces: customPieces,
        boardOrientation: "white",
        showNotation: false,
        showAnimations: false,
        allowDragging: true,
        allowDragOffBoard: true,
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
        onPieceDrop: handlePieceDrop,
        onSquareClick: ({ square }) => handleSquareClick(square),
      }}
    >
      <div className="stage">
        <section
          className="board-column board-column-editor"
          aria-label="Position editor board"
        >
          <div className="diagram">
            <div className="ranks" aria-hidden="true">
              {RANKS.map((rank) => (
                <span key={rank}>{rank}</span>
              ))}
            </div>
            <div className="board-wrap">
              <Chessboard />
            </div>
            <div className="files" aria-hidden="true">
              {FILES.map((file) => (
                <span key={file}>{file}</span>
              ))}
            </div>
          </div>

          <div className="fen-section">
            <div className="fen-line-row">
              <code className="fen-output" data-testid="fen-output">
                {currentFen}
              </code>
              <button type="button" onClick={handleCopyFen}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="fen-load-row">
              <label className="field-label" htmlFor="load-fen-input">
                Load FEN
              </label>
              <div className="fen-input-group">
                <input
                  id="load-fen-input"
                  type="text"
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  placeholder="Paste FEN string"
                />
                <button type="button" onClick={handleLoadFen}>
                  Load
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="side">
          <div className="setup" aria-label="Piece palette">
            <div className="field">
              <span className="field-label">Pieces</span>
              <div className="palette-grid">
                {WHITE_PIECES.map((item) => (
                  <div
                    key={item.code}
                    role="button"
                    tabIndex={0}
                    aria-label={item.label}
                    aria-pressed={tool === item.code}
                    className={
                      tool === item.code
                        ? "palette-cell palette-cell-active"
                        : "palette-cell"
                    }
                    onClick={() => setTool(item.code)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setTool(item.code);
                      }
                    }}
                  >
                    <SparePiece pieceType={item.code} />
                  </div>
                ))}
                {BLACK_PIECES.map((item) => (
                  <div
                    key={item.code}
                    role="button"
                    tabIndex={0}
                    aria-label={item.label}
                    aria-pressed={tool === item.code}
                    className={
                      tool === item.code
                        ? "palette-cell palette-cell-active"
                        : "palette-cell"
                    }
                    onClick={() => setTool(item.code)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setTool(item.code);
                      }
                    }}
                  >
                    <SparePiece pieceType={item.code} />
                  </div>
                ))}
              </div>
            </div>

            <div className="choice-row">
              <button
                type="button"
                aria-pressed={tool === "remove"}
                onClick={() =>
                  setTool((curr) => (curr === "remove" ? null : "remove"))
                }
              >
                Remove
              </button>
              <button type="button" onClick={handleClearBoard}>
                Clear board
              </button>
              <button type="button" onClick={handleStartingPosition}>
                Starting position
              </button>
            </div>
          </div>

          <div className="editor-section" aria-label="Position settings">
            <div className="field">
              <span className="field-label">Side to move</span>
              <div className="choice-row">
                <button
                  type="button"
                  aria-pressed={turn === "w"}
                  onClick={() => setTurn("w")}
                >
                  White
                </button>
                <button
                  type="button"
                  aria-pressed={turn === "b"}
                  onClick={() => setTurn("b")}
                >
                  Black
                </button>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Castling rights</span>
              <div className="castling-list">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={castling.wK}
                    onChange={() => handleToggleCastling("wK")}
                  />
                  <span>White kingside</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={castling.wQ}
                    onChange={() => handleToggleCastling("wQ")}
                  />
                  <span>White queenside</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={castling.bK}
                    onChange={() => handleToggleCastling("bK")}
                  />
                  <span>Black kingside</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={castling.bQ}
                    onChange={() => handleToggleCastling("bQ")}
                  />
                  <span>Black queenside</span>
                </label>
              </div>
            </div>
          </div>

          <div className="editor-section" aria-label="Game options">
            <div className="field">
              <span className="field-label">Play as</span>
              <div className="choice-row">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={colorChoice === option.value}
                    onClick={() => onColorChoiceChange(option.value)}
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
                    onClick={() => onDifficultyChange(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loadError ? <p className="error-line">{loadError}</p> : null}
          {!validation.valid && validation.error ? (
            <p className="error-line">{validation.error}</p>
          ) : null}

          <div className="controls">
            <button
              type="button"
              disabled={!validation.valid}
              onClick={() => onPlayFromHere(currentFen)}
            >
              Play from here
            </button>
            <button type="button" onClick={onBack}>
              Back to game
            </button>
          </div>
        </aside>
      </div>
    </ChessboardProvider>
  );
}
