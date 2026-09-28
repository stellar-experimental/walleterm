# Illustration references

These images set the walleterm illustration style. ChatGPT image generation made them on 2026-09-28 from the project owner's direction.
The files are the unchanged originals. Only the names changed.
Read [the illustration standard](../ILLUSTRATION.md) before you draw from them.

`metrics.json` holds the measured style bands. `uv run design/tools/artcheck.py baseline` writes it again from these files.

| File | Size | Ground | Picture | Idea it can carry | Baseline |
| --- | --- | --- | --- | --- | --- |
| `01-moon-green-field.png` | 1672 × 941 | moss | Mascot under a cream moon, wordmark at left | Social preview, hero | yes |
| `02-request-line-draft.png` | 1672 × 941 | cream | Line leaves the wallet front, not the fold | Superseded by 04 | no: draft |
| `03-night-oval.png` | 1672 × 941 | black | Mascot inside a cream oval | Night section, avatar | yes |
| `04-request-line.png` | 1672 × 941 | cream | One arc from the fold to a moss dot | One request goes out | yes |
| `05-door-threshold.png` | 1254 × 1254 | cream | Mascot faces a tall moss door, red light under it | Approval, a threshold | yes |
| `06-arc-three-dots.png` | 1254 × 1254 | cream | Arc with three moss dots of different sizes | Destinations, steps | yes |
| `07-balance-scale.png` | 1254 × 1254 | tomato | Mascot on a scale against a cream ball | Verification, weighing | no: fill matches ground |
| `08-bridge-walk.png` | 1254 × 1254 | cream | Mascot walks a line across a gap between moss blocks | The website bridge | no: walking pose |
| `09-forked-path.png` | 1672 × 941 | cream | Mascot where two lines split, moss square on one | A choice of key or path | yes |
| `10-keyhole.png` | 1672 × 941 | deep moss | Mascot beside a large cream keyhole | Keys stay locked | yes |
| `11-horizon-moon.png` | 1672 × 941 | black | Small mascot on a horizon, large moon | Install, goodnight | yes |
| `12-red-barrier.png` | 1672 × 941 | cream | Tomato bar between the mascot and a moss dot | A boundary | yes |
| `13-spotlight-mat.png` | 1254 × 1254 | black | Mascot alone on a small moss mat | Empty state, 404 | yes |
| `14-three-doorways.png` | 1672 × 941 | cream | Three open door frames that get smaller | Three steps | yes |
| `15-moss-circle.png` | 1672 × 941 | cream | Moss circle above the mascot on a ground line | Portrait, avatar | yes |
| `16-hourglass.png` | 1672 × 941 | cream | Outline hourglass with moss sand, mascot waits | A code that expires | yes |

`artcheck.py` names the excluded files and the reasons in its `EXCLUDE` table.
Keep these files outside `site/`, so they do not deploy with the website.

The files stay in plain Git with their original bytes. Git LFS would add a required tool to every clone and CI run.
GitHub source archives would then hold pointer files, not images. Lossless recompression saves only 12%.

The site uses 01 (hero), 04 (How it works), 10 (Boundaries), 08 (Websites), and 11 (Install).
