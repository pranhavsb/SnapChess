import { useCallback, useEffect, useRef, useState } from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { getBestMove, stopEngine } from "./engine";

export type ColorChoice = "white" | "black" | "random";
export type PromotionPiece = "q" | "r" | "b" | "n";

export type PendingPromotion = {
  from: Square;
  to: Square;
};

export type MoveRow = {
  n: number;
  white: string;
  black: string;
};

export function difficultyToSkillLevel(difficulty: number): number {
  const clamped = Math.max(1, Math.min(10, Math.round(difficulty)));
  return Math.round(((clamped - 1) * 20) / 9);
}

function findKingSquare(game: Chess): Square | null {
  const color = game.turn();
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.type === "k" && piece.color === color) {
        return piece.square;
      }
    }
  }
  return null;
}

function computeStatus(
  game: Chess,
  resignedBy: Color | null,
): { statusText: string | null; resultScore: string | null } {
  if (resignedBy) {
    const winner = resignedBy === "w" ? "Black" : "White";
    const loser = resignedBy === "w" ? "White" : "Black";
    return {
      statusText: `${loser} resigned. ${winner} wins.`,
      resultScore: resignedBy === "w" ? "0-1" : "1-0",
    };
  }

  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    return {
      statusText: `Checkmate. ${winner} wins.`,
      resultScore: game.turn() === "w" ? "0-1" : "1-0",
    };
  }

  if (game.isStalemate()) {
    return {
      statusText: "Stalemate. Draw.",
      resultScore: "1/2-1/2",
    };
  }

  if (game.isThreefoldRepetition()) {
    return {
      statusText: "Draw by repetition.",
      resultScore: "1/2-1/2",
    };
  }

  if (game.isInsufficientMaterial()) {
    return {
      statusText: "Draw by insufficient material.",
      resultScore: "1/2-1/2",
    };
  }

  if (game.isDraw()) {
    return {
      statusText: "Draw.",
      resultScore: "1/2-1/2",
    };
  }

  return { statusText: null, resultScore: null };
}

function buildMoveRows(moves: string[], initialTurn: Color): MoveRow[] {
  if (moves.length === 0) return [];
  const rows: MoveRow[] = [];

  if (initialTurn === "b") {
    rows.push({
      n: 1,
      white: "...",
      black: moves[0] ?? "",
    });
    for (let i = 1; i < moves.length; i += 2) {
      rows.push({
        n: Math.floor((i + 1) / 2) + 1,
        white: moves[i] ?? "",
        black: moves[i + 1] ?? "",
      });
    }
    return rows;
  }

  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      n: i / 2 + 1,
      white: moves[i] ?? "",
      black: moves[i + 1] ?? "",
    });
  }
  return rows;
}

export function useGame() {
  const gameRef = useRef<Chess>(new Chess());
  const requestIdRef = useRef(0);
  const initialTurnRef = useRef<Color>("w");

  const [colorChoice, setColorChoice] = useState<ColorChoice>("white");
  const [difficulty, setDifficulty] = useState<number>(5);
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [orientation, setOrientation] = useState<"white" | "black">("white");

  const [fen, setFen] = useState<string>(() => gameRef.current.fen());
  const [moves, setMoves] = useState<string[]>([]);
  const [turn, setTurn] = useState<Color>("w");
  const [inCheck, setInCheck] = useState<boolean>(false);
  const [checkedKingSquare, setCheckedKingSquare] = useState<Square | null>(null);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(
    null,
  );
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [resignedBy, setResignedBy] = useState<Color | null>(null);
  const [gameActive, setGameActive] = useState<boolean>(false);

  const syncFromEngine = useCallback(() => {
    const g = gameRef.current;
    setFen(g.fen());
    setMoves(g.history());
    setTurn(g.turn());
    const check = g.isCheck();
    setInCheck(check);
    setCheckedKingSquare(check ? findKingSquare(g) : null);
    setSelectedSquare(null);
  }, []);

  const startGame = useCallback(
    (customFen?: string, nextChoice?: ColorChoice) => {
      requestIdRef.current += 1;
      stopEngine();

      const g = gameRef.current;
      if (customFen && customFen.trim().length > 0) {
        g.load(customFen.trim());
      } else {
        g.reset();
      }

      initialTurnRef.current = g.turn();

      const effectiveChoice = nextChoice ?? colorChoice;
      const resolvedColor: Color =
        effectiveChoice === "white"
          ? "w"
          : effectiveChoice === "black"
            ? "b"
            : Math.random() < 0.5
              ? "w"
              : "b";

      setPlayerColor(resolvedColor);
      setOrientation(resolvedColor === "w" ? "white" : "black");
      setResignedBy(null);
      setPendingPromotion(null);
      setIsThinking(false);
      setGameActive(true);
      syncFromEngine();
    },
    [colorChoice, syncFromEngine],
  );

  const isGameOver = resignedBy !== null || gameRef.current.isGameOver();
  const isPlayerTurn =
    gameActive && !isGameOver && !isThinking && turn === playerColor;

  useEffect(() => {
    if (!gameActive || isGameOver) return;
    if (turn === playerColor) return;

    const currentRequestId = ++requestIdRef.current;
    const currentFen = gameRef.current.fen();
    const skillLevel = difficultyToSkillLevel(difficulty);

    setIsThinking(true);

    getBestMove(currentFen, skillLevel)
      .then((uciMove) => {
        if (requestIdRef.current !== currentRequestId) return;
        if (!uciMove || uciMove === "(none)") {
          setIsThinking(false);
          return;
        }

        const from = uciMove.slice(0, 2) as Square;
        const to = uciMove.slice(2, 4) as Square;
        const promoChar = uciMove.slice(4, 5).toLowerCase();
        const promotion = (
          ["q", "r", "b", "n"].includes(promoChar) ? promoChar : undefined
        ) as PieceSymbol | undefined;

        try {
          gameRef.current.move({ from, to, promotion });
          syncFromEngine();
        } catch {
          // ignore invalid engine move if state changed
        } finally {
          if (requestIdRef.current === currentRequestId) {
            setIsThinking(false);
          }
        }
      })
      .catch(() => {
        if (requestIdRef.current === currentRequestId) {
          setIsThinking(false);
        }
      });
  }, [gameActive, isGameOver, turn, playerColor, difficulty, fen, syncFromEngine]);

  const isPromotionTarget = useCallback((from: Square, to: Square): boolean => {
    const g = gameRef.current;
    const piece = g.get(from);
    if (!piece || piece.type !== "p") return false;
    const targetRank = to[1];
    if (
      (piece.color === "w" && targetRank !== "8") ||
      (piece.color === "b" && targetRank !== "1")
    ) {
      return false;
    }
    const legal = g.moves({ square: from, verbose: true });
    return legal.some((m) => m.to === to && m.isPromotion());
  }, []);

  const attemptMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!gameActive || isGameOver || isThinking) return false;
      const g = gameRef.current;
      if (g.turn() !== playerColor) return false;

      if (isPromotionTarget(from, to)) {
        setPendingPromotion({ from, to });
        setSelectedSquare(null);
        return true;
      }

      try {
        g.move({ from, to });
        setPendingPromotion(null);
        syncFromEngine();
        return true;
      } catch {
        return false;
      }
    },
    [gameActive, isGameOver, isThinking, playerColor, isPromotionTarget, syncFromEngine],
  );

  const selectPromotion = useCallback(
    (piece: PromotionPiece): boolean => {
      if (!pendingPromotion) return false;
      if (!gameActive || isGameOver || isThinking) {
        setPendingPromotion(null);
        return false;
      }
      try {
        gameRef.current.move({
          from: pendingPromotion.from,
          to: pendingPromotion.to,
          promotion: piece,
        });
        setPendingPromotion(null);
        syncFromEngine();
        return true;
      } catch {
        setPendingPromotion(null);
        return false;
      }
    },
    [pendingPromotion, gameActive, isGameOver, isThinking, syncFromEngine],
  );

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
  }, []);

  const handleSquareClick = useCallback(
    (square: string) => {
      if (!gameActive || isGameOver || isThinking) {
        setSelectedSquare(null);
        return;
      }
      const g = gameRef.current;
      if (g.turn() !== playerColor) {
        setSelectedSquare(null);
        return;
      }

      const target = square as Square;
      if (selectedSquare === target) {
        setSelectedSquare(null);
        return;
      }

      if (selectedSquare) {
        const legal = g.moves({ square: selectedSquare, verbose: true });
        if (legal.some((m) => m.to === target)) {
          attemptMove(selectedSquare, target);
          return;
        }
      }

      const piece = g.get(target);
      if (piece && piece.color === playerColor) {
        setSelectedSquare(target);
        return;
      }

      setSelectedSquare(null);
    },
    [gameActive, isGameOver, isThinking, playerColor, selectedSquare, attemptMove],
  );

  const canDragPiece = useCallback(
    (pieceType: string): boolean => {
      if (!gameActive || isGameOver || isThinking || pendingPromotion !== null) {
        return false;
      }
      if (turn !== playerColor) return false;
      return pieceType.startsWith(playerColor);
    },
    [gameActive, isGameOver, isThinking, pendingPromotion, turn, playerColor],
  );

  const undo = useCallback(() => {
    if (!gameActive || isThinking) return;
    const g = gameRef.current;
    const historyLen = g.history().length;
    if (historyLen === 0) return;

    requestIdRef.current += 1;
    stopEngine();
    setIsThinking(false);
    setPendingPromotion(null);
    setResignedBy(null);

    if (g.turn() === playerColor && historyLen >= 2) {
      g.undo();
      g.undo();
    } else {
      g.undo();
    }

    syncFromEngine();
  }, [gameActive, isThinking, playerColor, syncFromEngine]);

  const flipBoard = useCallback(() => {
    setOrientation((curr) => (curr === "white" ? "black" : "white"));
  }, []);

  const resign = useCallback(() => {
    if (!gameActive || isGameOver) return;
    requestIdRef.current += 1;
    stopEngine();
    setIsThinking(false);
    setPendingPromotion(null);
    setSelectedSquare(null);
    setResignedBy(playerColor);
  }, [gameActive, isGameOver, playerColor]);

  const changeColorChoice = useCallback(
    (nextChoice: ColorChoice) => {
      setColorChoice(nextChoice);
      if (!gameActive) {
        if (nextChoice === "white") setOrientation("white");
        if (nextChoice === "black") setOrientation("black");
      }
    },
    [gameActive],
  );

  const { statusText, resultScore } = computeStatus(gameRef.current, resignedBy);
  const moveRows = buildMoveRows(moves, initialTurnRef.current);

  const canUndo =
    gameActive &&
    !isThinking &&
    moves.length > 0 &&
    !(moves.length === 1 && turn === playerColor);

  const canResign = gameActive && !isGameOver;

  return {
    fen,
    moves,
    moveRows,
    turn,
    playerColor,
    colorChoice,
    setColorChoice: changeColorChoice,
    difficulty,
    setDifficulty,
    skillLevel: difficultyToSkillLevel(difficulty),
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
    isGameOver,
    isPlayerTurn,
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
  };
}
