# Brand assets

Generated from the supplied WonderAgent logo (2026-09-18). Rendered through
`modules/ui/Logo.tsx` — import that component rather than referencing these
files directly, so sizing and the light/dark pairing stay consistent.

| File | Use |
|---|---|
| `wonderagent-logo-light.png` | Full lockup (badge + wordmark + tagline), **light** surfaces |
| `wonderagent-logo-dark.png` | Full lockup, **dark** surfaces |
| `wonderagent-wordmark-light.png` | Badge + wordmark, no tagline, **light** surfaces |
| `wonderagent-wordmark-dark.png` | Badge + wordmark, no tagline, **dark** surfaces |
| `wonderagent-mark.png` | Badge alone — square/small placements, either theme |
| `wonderagent-icon-512.png` | Square, padded, transparent — source for `app/icon.png` |
| `wonderagent-icon-apple-180.png` | Square on brand navy — source for `app/apple-icon.png` (iOS composites on an opaque tile) |

## Why there are two of the lockup

The wordmark's "onder" is a dark neutral (#4a4f5c-ish). It all but
disappears on a dark surface, so the dark variants recolour **only** the
neutral text — wordmark to `#ECEFF5`, tagline to `#9AA6BA` — and leave the
badge and the blue/purple "Agent" untouched. The split is by saturation
(neutral text measures ~0.24, brand colours ≥0.82), so the gradient letters
can never be caught by it.

`Logo` renders both and lets `.theme-light-only` / `.theme-dark-only`
(`app/globals.css`) show one. Those guards mirror the token blocks, so the
logo cannot disagree with the surface behind it.

The mark needs no pair: it is brand-coloured throughout and reads on both.

## Regenerating

The extraction scripts are not kept in the repo — they were one-off. If the
source logo changes, note what the originals required:

- The supplied file was on a **near-white** background (253–255, not pure
  white), so a plain white key left everything faintly opaque. Alpha comes
  from flood-filling the background **inward from the borders**, which also
  keeps the white robot face and W strokes *inside* the badge opaque.
- The letter "o" is kerned **behind** the badge, so no vertical crop
  separates them. The mark is built by keeping only the connected
  components whose mean saturation is ≥0.45 (the badge's are 0.82–0.90, the
  letter's 0.24).
