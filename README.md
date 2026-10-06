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
- **Top N**, **loop**, speed (1x = 1 s per frame)
- Rank column optional; without it, rank is computed from the value per frame.
