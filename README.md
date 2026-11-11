# SnapChess

Coming Soon!

## Retraining from scan labels

After a board is flattened, every square can be confirmed or corrected on the
grid. While "Share corrections" is on (scan side panel, on by default), each
confirmed square is queued in the browser and uploaded to Supabase: one row in
`scan_labels` plus the square's crops in the private `scan-crops` bucket under
`<session_id>/<board_id>/`. Rows are append-only; the latest row per
`(board_id, square)` is the label. Apply
`supabase/migrations/20261111190000_scan_labels_per_square.sql` first.

1. Export the dataset. The service role key reads every user's labels, so it
   belongs in your local shell only, never in `.env` or a `VITE_` variable:

   ```powershell
   $env:SUPABASE_URL = "https://<project>.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
   npm run export:training -- --out dataset --since 2026-11-01
   ```

   This writes `dataset/tall/<label>/<id>.png`, `dataset/tight/<label>/<id>.png`
   (labels `white_king` .. `black_pawn`, `empty`) and `dataset/manifest.csv`.
   `dataset/` is git-ignored.
2. Oversample the rows with `is_correction = true` (for example 3x): those are
   the squares the current model got wrong.
3. Train with exactly the crop geometry the app will use at inference
   (`crop_geometry` in the manifest says what each crop is).
4. Export ONNX to `public/models/snapchess_pieces.onnx`.
5. Bump `model_version` in `public/models/model_info.json` so new labels record
   which model produced the guess.
6. Set the crop mode in `model_info.json` (see below).
