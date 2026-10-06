# Bar Race (Tableau dashboard extension)

Self-hosted replacement for the Inovista Bar Race extension. Plain HTML/CSS/JS, no build step.

## Files

| File | Purpose |
|------|---------|
| `index.html`, `bar_race.js`, `bar_race.css` | The extension itself — publish these three to GitHub Pages |
| `bar_race.trex` | Manifest Tableau loads. Edit `<url>` to the Pages URL of `index.html` |

## Try it without Tableau

Open `index.html?mock=1` in a browser — it plays generated sample data.

## Publish

1. Put `index.html`, `bar_race.js`, `bar_race.css` at the root of a GitHub repo, enable Pages (Settings → Pages), note the URL.
2. Edit `<url>` in `bar_race.trex` to `https://<user>.github.io/<repo>/index.html`.
3. Tableau Cloud admin: Settings → Extensions → **Enable Specific Extensions** → add that URL (this extension is network-enabled, not sandboxed).
4. Dashboard: drag an **Extension** object in → *My Extensions* → pick `bar_race.trex`.

GitHub Pages URLs are public. Only the chart code lives there; the data is passed by Tableau in the viewer's browser.

## Worksheet fields

The extension reads one worksheet's summary data. Put these on the worksheet (Detail is fine) and hide the sheet in the dashboard:

`Frame Hour`, `Player Id`, `Player Name`, `Point` (SUM), `Rank`; `Event` as a context filter.

Open ⚙ to map fields. Settings save in authoring mode; viewers get the saved mapping.

## Options (⚙)

- **Frames:** all, or the last frame of each day (6-hour data → one frame per day)
- **Axis:** zoom to data (starts at a round number below the lowest score) or from 0
- **Top N** (default 50)
- Rank column optional; without it, rank is computed from the value per frame.

Toolbar (not saved): speed (1x = 1 s per frame) and **loop** — unchecked by default, so playback stops on the last frame; ⏮ / ▶ replays.

## Customizing

**Bar thickness is set by Top N, not by CSS.** `layout()` in `bar_race.js` fits every row into the stage:
row height ≈ stage height ÷ row count, clamped to 10–36 px, and written inline as `--row-h` on `<html>` —
so the `--row-h` in `bar_race.css` is only a pre-load fallback and editing it has no visible effect.
At 50 rows in a 600 px tile a row is ~11 px; at 20 rows it is ~29 px. For thicker bars, lower Top N or make the tile taller.

Where Top N comes from:
- ⚙ → Top N → Apply. In authoring mode this saves into the workbook, and **a saved value overrides the code default**.
- `DEFAULT_CFG.topn` in `bar_race.js` — default for a fresh extension and for `?mock=1`.
- `value="50"` on `#s-topn` in `index.html` is overwritten on load; keep it in step for consistency only.

Style knobs in `:root` of `bar_race.css`:

| Variable | Effect |
|----------|--------|
| `--bar-gap` | Space between bars; bar height = row height − gap |
| `--font-scale` | Row text size = row height × this |
| `--font-min`, `--font-max` | Clamp for row text size |

Values are shown without a thousands separator (`useGrouping: false` in `render()`).
