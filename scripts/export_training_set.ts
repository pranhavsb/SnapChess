// Export confirmed scan labels from Supabase into an ImageFolder dataset.
//
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
//   npm run export:training -- --out dataset --since 2026-11-01
//
// The service role key bypasses row level security so it can read every
// user's labels. It is for this local script only: never put it in .env,
// never prefix it with VITE_, never ship it to the browser.
//
// Output:
//   <out>/tall/<label>/<id>.png    crop the app sent to the model (tall or legacy)
//   <out>/tight/<label>/<id>.png   exact 100x100 square
//   <out>/manifest.csv
// Rows are append-only; only the latest row per (board_id, square) is kept.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "scan-crops";
const PAGE = 1000;
const CONCURRENCY = 8;

const PIECE_NAMES: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
  P: "pawn",
};

type Row = {
  id: string;
  session_id: string;
  board_id: string;
  created_at: string;
  square: string;
  colour: "w" | "b" | "empty";
  piece: string | null;
  source: string;
  is_correction: boolean;
  model_guess: string | null;
  model_version: string | null;
  model_confidence: number | null;
  crop_image_path: string | null;
  tight_crop_path: string | null;
  camera_side: string | null;
  crop_geometry: string | null;
};

function parseArgs(argv: string[]): { out: string; since: string | null } {
  let out = "dataset";
  let since: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") out = argv[++i] ?? out;
    else if (argv[i] === "--since") since = argv[++i] ?? null;
  }
  return { out, since };
}

function labelOf(row: Row): string {
  if (row.colour === "empty") return "empty";
  const side = row.colour === "w" ? "white" : "black";
  return `${side}_${PIECE_NAMES[row.piece ?? ""] ?? "unknown"}`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  const { out, since } = parseArgs(process.argv.slice(2));
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const latest = new Map<string, Row>();
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("scan_labels")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    for (const row of rows) latest.set(`${row.board_id}/${row.square}`, row);
    if (rows.length < PAGE) break;
  }

  const rows = [...latest.values()];
  console.log(`${rows.length} labelled squares`);

  const manifest = [
    [
      "id", "label", "square", "source", "is_correction", "model_guess",
      "model_version", "model_confidence", "board_id", "session_id",
      "created_at", "camera_side", "crop_geometry", "tall_path", "tight_path",
    ].join(","),
  ];
  let failed = 0;

  async function download(remote: string | null, local: string): Promise<string> {
    if (!remote) return "";
    const { data, error } = await supabase.storage.from(BUCKET).download(remote);
    if (error || !data) {
      failed += 1;
      console.warn(`missing ${remote}: ${error?.message ?? "no data"}`);
      return "";
    }
    await mkdir(path.dirname(local), { recursive: true });
    await writeFile(local, Buffer.from(await data.arrayBuffer()));
    return path.relative(out, local).split(path.sep).join("/");
  }

  const lines = new Map<string, string>();
  await pool(rows, CONCURRENCY, async (row) => {
    const label = labelOf(row);
    const tall = await download(row.crop_image_path, path.join(out, "tall", label, `${row.id}.png`));
    const tight = await download(row.tight_crop_path, path.join(out, "tight", label, `${row.id}.png`));
    lines.set(
      row.id,
      [
        row.id, label, row.square, row.source, row.is_correction, row.model_guess,
        row.model_version, row.model_confidence, row.board_id, row.session_id,
        row.created_at, row.camera_side, row.crop_geometry, tall, tight,
      ].map(csvCell).join(","),
    );
  });

  for (const row of rows) {
    const line = lines.get(row.id);
    if (line) manifest.push(line);
  }
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "manifest.csv"), `${manifest.join("\n")}\n`);
  console.log(`Wrote ${path.join(out, "manifest.csv")}${failed ? ` (${failed} files missing)` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
