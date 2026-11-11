import type { PieceRenderObject } from "react-chessboard";

// Cburnett pieces, Colin M.L. Burnett, CC BY-SA 3.0.

const pieceStyle = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "contain",
  borderRadius: 0,
  boxShadow: "none",
} as const;

function cburnett(type: string) {
  return function Piece() {
    return (
      <img
        alt=""
        draggable={false}
        src={`/pieces/${type}.svg`}
        style={pieceStyle}
      />
    );
  };
}

export const customPieces: PieceRenderObject = {
  wK: cburnett("wK"),
  wQ: cburnett("wQ"),
  wR: cburnett("wR"),
  wB: cburnett("wB"),
  wN: cburnett("wN"),
  wP: cburnett("wP"),
  bK: cburnett("bK"),
  bQ: cburnett("bQ"),
  bR: cburnett("bR"),
  bB: cburnett("bB"),
  bN: cburnett("bN"),
  bP: cburnett("bP"),
};
