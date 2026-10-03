# Lupi Daily

One mystery molecule a day, the same for everyone. You name it from an ink silhouette in at most six guesses. Each wrong guess opens the next clue. When you name it, the drawing blooms into colour and "Open in 3D" takes it into the viewer. Short-list item 11 (round 1 [C088](brainstorm/2026-09-viewer-play/round1-catalog.md#c088); round 2 [The Daily, shared without spoilers](brainstorm/2026-09-viewer-play/round2/capture-share-loops.md#r2-capture-share-loops-10)).

There is no canvas. The page is static HTML with a small script: no React and no three.

## Routes

| Path | What it is |
|---|---|
| `/daily/` (and `/daily`) | Today's puzzle, by the visitor's local date. It rolls over at local midnight. |
| `/daily/<YYYY-MM-DD>` | One date's puzzle. Its share card is that day's silhouette. Written from No. 1 (2026-10-01) to 120 days past the build. |
| `/daily/text` | The same game in words, for screen readers and anyone who prefers text. It shares the guesses and streak of the picture version. |
| `/daily/pool.json` | Every guessable name. |
| `/daily/schedule.json` | The queue's tokens in order. The home page's Daily card reads it. |
| `/daily/p/<token>.json` | One molecule's drawing and its sealed clues. |
| `/og/daily/<date>.jpg`, `/og/daily.jpg` | 1200×630 share cards. Date cards cover 14 days before the build to 60 days after. |

A date page opens in one of these states:

- **Today:** you play it.
- **Tomorrow:** it is already that date in some time zones. You can play it, and it counts for that day.
- **A past date:** you can play it (practice), reveal the answer, or go to today's puzzle.
- **A later date:** "No peeking".
- **Before No. 1:** the page says when the Daily begins.

## The game

The clue ladder pairs each drawing with a written twin:

| Clue | Drawing | Words |
|---|---|---|
| 1 | Silhouette, still | Size and shape ("24 atoms around a flat core, about 7 × 6 Å.") |
| 2 | Silhouette, now turnable | Elements |
| 3 | Outline: bonds and rings | Rings and bonds ("Two rings: a pentagon and a hexagon, fused together.") |
| 4 | CPK colours | Formula |
| 5 | Colours | Room-temperature property and molar mass |
| 6 | Colours | Name pattern (`C _ _ _ _ _ _ _`) |

- **Guesses** come from a type-ahead over the 69 molecule pages, with their other names, plus about 65 common molecules Lupi has no page for. The decoys can be guessed but are never the answer.
- **Warmth.** Every wrong guess shows a warmth from 0 to 99: how alike it is to the answer. Likeness is scored from the library facets, shared elements, size and shelf, then ranked across all names, so the closest name scores 99. It is Lupi's similarity score, not a measurement, and the page says so.
- **The bloom.** The paper disc opens onto the sage plate as the lit ink drawing, and the name rises letter by letter. Gentle shortens the bloom, and Still cuts it. Haptics fire only if the visitor turned them on in the viewer's Settings. There is no sound.
- **Open in 3D** hands the drawing's pose to the viewer through the relay baton (`source: 'page'`), as the `/m` pages do.
- **Share** text never names the answer:

  ```
  Lupi Daily No. 3 · Sat 3 Oct
  Solved on clue 3 of 6
  🟦🟧🟩⬜⬜⬜
  https://lupi.live/daily/2026-10-03
  ```

  Each square is one guess: its warmth colour, green for the answer, and white for clues not needed. Phones open the share sheet; desktops copy the text.
- **Stats and streaks** are kept in localStorage (`lupi.daily.v1`) on this device only:
  - The panel shows games played, the solve rate, the current and best streaks, and a bar of wins by clue.
  - A day counts only when it is solved on its own day, or a day early across time zones. A past puzzle played later is practice.
  - A broken streak is simply not shown.
- **Also on the page:**
  - This week's strip.
  - Yesterday's silhouette, which blooms into its answer on tap.
  - The countdown to the next molecule.

## Spoilers

No file name, URL, meta tag, structured data, card or page title ever names an answer:

- **Tokens.** Tokens are a salted hash of the gallery id.
- **The clear model.** The puzzle file carries the drawing with its element symbols stripped.
- **The seal.** The name, clues and warmth table are sealed with an XOR keystream keyed by the token, plus base64. That is not security, and cannot be, because the page must open it to check a guess. It keeps the answer out of view-source and out of scrapers, as Wordle's word list sat in its bundle.

## The queue

`scripts/daily/queue.mts` holds the queue:

- **The molecules.** 55 recognisable gallery molecules with a `/m` page.
- **The order.** The first pass is curated: friendly shapes first, and teaching molecules toward the end. Later passes are seeded shuffles, and no molecule plays two days running across a pass boundary.
- **Left out of the answers:**
  - recreational and illicit drugs (LSD, psilocybin, THC, CBD, MDMA, mescaline, DMT, ketamine, nicotine and nitrous oxide);
  - two-atom shapes;
  - bulk structures.

  They can still be guessed.

**Append to the queue; never reorder it.** Reordering re-maps every past day. Stored days survive this, because each record remembers its token and resets if the token changed, but shared links would then open a different molecule.

The clues are generated in `scripts/daily/clues.mts`, from:

- the coordinate file;
- the PubChem formula;
- the property sheet;
- ring faces from Object Facts' ring finder.

## Build and dev

- **Build.** `pnpm --filter @atlas/web build` runs `scripts/generate-daily-pages.mts` after the molecule pages. It takes about 3 s and adds about 6 MB: 125 small pages, 55 puzzle files and about 65 JPEG cards. `LUPI_DAILY_TODAY=YYYY-MM-DD` pins the build date, which sets the window of pages and cards.
- **Dev.** `pnpm dev` serves every Daily artifact on request (`dailyDevPlugin` in `apps/web/vite.config.ts`).

## Code

| File | What it holds |
|---|---|
| `packages/ui/src/daily/schedule.ts` | Dates, the queue order, the daily pose and paths. Pure. |
| `packages/ui/src/daily/secret.ts` | Data shapes and the seal. |
| `packages/ui/src/daily/store.ts` | History, stats and streaks. |
| `packages/ui/src/daily/art.ts` | The silhouette, outline and colour looks as strings. |
| `packages/ui/src/daily/painter.ts` | The same looks as live nodes under the ink stage. |
| `packages/ui/src/daily/combobox.ts` | The type-ahead. |
| `packages/ui/src/daily/share.ts` | The result text and glyph row. |
| `packages/ui/src/daily/page.ts` | The page. |
| `packages/ui/src/daily/daily.css` | Styles. |
| `packages/ui/src/landing/DailyCard.tsx` | The home page's door. |
| `scripts/daily/*` | The build: queue, clues and warmth, cards, HTML and writing. |
