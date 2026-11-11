// Builds public/models/position_prior.json: how often each piece stands on each
// square across real games. The scanner uses it to break ties when the piece
// model is unsure (for example knight vs bishop on c3).
//
// Usage: npm run build:prior -- [maxGames] [databaseUrl]

import { writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { Decompress } from "fzstd";

const DEFAULT_URL =
  "https://database.lichess.org/standard/lichess_db_standard_rated_2013-01.pgn.zst";
const OUTPUT = "public/models/position_prior.json";
const CLASSES = ["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];
const MIN_PLIES = 10;

const maxGames = Number(process.argv[2] ?? 20000);
const url = process.argv[3] ?? DEFAULT_URL;

const counts: number[][] = Array.from({ length: 64 }, () => new Array(13).fill(0));
let games = 0;
let positions = 0;
let skipped = 0;

function classIndex(type: string, color: "w" | "b"): number {
  const symbol = color === "w" ? type.toUpperCase() : type;
  return CLASSES.indexOf(symbol);
}

function countPosition(chess: Chess): void {
  const board = chess.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board[row][col];
      const cls = piece ? classIndex(piece.type, piece.color) : 0;
      counts[row * 8 + col][cls] += 1;
    }
  }
  positions += 1;
}

function sanTokens(movetext: string): string[] {
  return movetext
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, " ")
    .replace(/[?!]+/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function processGame(movetext: string): void {
  const tokens = sanTokens(movetext);
  if (tokens.length < MIN_PLIES) {
    skipped += 1;
    return;
  }
  const chess = new Chess();
  countPosition(chess);
  for (const san of tokens) {
    try {
      chess.move(san);
    } catch {
      break;
    }
    countPosition(chess);
  }
  games += 1;
  if (games % 2000 === 0) {
    console.log(`${games} games, ${positions} positions`);
  }
}

async function main(): Promise<void> {
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const text = new TextDecoder();
  let pending = "";
  let variantGame = false;
  let done = false;

  const handleText = (chunk: string): void => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const raw of lines) {
      if (done) return;
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("[")) {
        if (line.startsWith("[Event ")) variantGame = false;
        if (line.startsWith("[Variant ") && !line.includes('"Standard"')) {
          variantGame = true;
        }
        continue;
      }
      if (!variantGame) processGame(line);
      if (games >= maxGames) done = true;
    }
  };

  const decompress = new Decompress((chunk) => {
    if (!done) handleText(text.decode(chunk, { stream: true }));
  });

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) {
      decompress.push(new Uint8Array(0), true);
      break;
    }
    decompress.push(value);
  }
  await reader.cancel().catch(() => undefined);

  const output = {
    source: url,
    games,
    positions,
    skippedShortGames: skipped,
    note: "counts[square][class]; squares a8..h8, a7..h7, ..., a1..h1; one count per position after every ply",
    classes: CLASSES,
    counts,
  };
  writeFileSync(OUTPUT, JSON.stringify(output));
  console.log(`wrote ${OUTPUT}: ${games} games, ${positions} positions`);
}

// The partially read download keeps a socket open, so exit explicitly.
main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
