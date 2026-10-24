# Purrclub UI → Polaris web components (design)

Date: 2026-10-24 · Status: draft for review

## Goal

Rebuild every UI element in [index.html](../../../index.html) with the Shopify App Home web components
(`<s-button>`, `<s-badge>`, `<s-table>`, `<s-modal>`, …) documented at
https://shopify.dev/docs/api/app-home-ui-extension/latest/web-components, while **keeping the existing
Purrclub color scheme** (cream / pumpkin / purple, with its dark mode). App logic, API calls, scoring and
the recap card are unchanged.

## What the spike established

Tested standalone (no Shopify admin, no App Bridge) in headless Chrome:

- `https://cdn.shopify.com/shopifycloud/polaris.js` loads on a plain page; `s-button`, `s-badge`,
  `s-text-field`, `s-table`, `s-avatar` render.
- Theming works through CSS custom properties that components read as
  `var(--p-color-…-f4125, fallback)`. Setting them on `body` recolors buttons and badges.
  Names are **per component** (e.g. `--p-color-button-primary-bg-f4125`, `--p-color-bg-fill-success-secondary-f4125`);
  there is no single brand token. `f4125` is a build hash.
- `s-button-group` renders nothing useful unless its children use its action slots, so it is not used for tabs.
- Not yet solved: avatar initials stayed teal (token not found); dark mode untested with components.

## Decisions

1. **Real components, not lookalikes.** Loaded from the CDN `polaris.js` in `<head>`.
2. **One theme block** maps the Purrclub palette onto Polaris tokens. It references the existing
   variables (`var(--pumpkin)` etc.), so the existing light/dark switching carries over with no
   second set of values. It lives in one place so the `f4125` hash is a one-line fix if Shopify rebuilds.
3. **Keep the custom `:root` palette variables** as the single source of truth for colors.
4. **Font: Plus Jakarta Sans everywhere** (Google Fonts, weights 400/500/600/700/800). Set
   `--p-font-family-sans-f4125` in the theme block so every Polaris component uses it, and set it on
   `body` for custom elements. This **replaces Eater (h1) and Barlow / Barlow Condensed (scoreboard,
   headings)**. The title and the large score digits stay as custom elements (no Polaris equivalent), but
   in Plus Jakarta Sans at weight 800, with `font-variant-numeric: tabular-nums` on the digits.
5. **Keep the custom toast** (`#toast`), restyled with palette variables. App Home toasts need App Bridge, which isn't available here.
6. **Recap card unchanged.** It is drawn on a canvas from data, not captured from the DOM. Because the
   canvas still uses Eater / Barlow, keep those Google Fonts links loaded (alongside Plus Jakarta Sans),
   or the story image would silently fall back to a default font. Switching the recap to Plus Jakarta Sans is a separate, optional change.

## Component mapping

| Today | Becomes | Notes |
|---|---|---|
| `button.pri` | `s-button variant="primary"` | |
| `button.ghost`, `.mini button`, `.tools button` | `s-button variant="secondary"` | |
| `button.danger`, `.tools .dg` | `s-button tone="critical"` (primary in modals, secondary in tools) | |
| `td button.sm` (Recap) | `s-button variant="tertiary"` | |
| `+ Poin` buttons | `s-button variant="primary" inlineSize="fill"` in `s-grid` 2 cols | keep two-line label |
| Tabs (`nav button`) | row of `s-button` in `s-stack direction="inline"`; selected = `primary`, others `secondary`; `inlineSize="fill"` | No tabs component exists. Keep `role="tab"`/`aria-selected` on the hosts. |
| `.chip` / `.chip.cta` | CTA: `s-button variant="primary"`; profile: `s-clickable` wrapping `s-avatar` + `s-text` | |
| `.av` avatar | `s-avatar src=… initials=… size=…` | Sizes snap to the documented scale: ≤34 → `small`, 64 → `large`, 120/140 → `large-200`. |
| `.tag`, `.liveTag` | `s-badge` (`Selesai` = success, `Giliran main` = info, `Menunggu` = neutral) | |
| `.banner`, `.rules` | `s-banner tone="info"` | |
| `.match`, `.pcard`, `.recapCta`, `.tblWrap` | `s-section` (heading = title) | Live match keeps a purple emphasis border via a thin wrapper `div.live`. |
| `.teams` / `.scoreRow` layout | `s-grid` + `s-stack` | Score digits stay custom CSS. |
| `table` | `s-table` (+ `-header-row`, `-header`, `-body`, `-row`, `-cell`) | See "Standings on mobile" below. |
| `.linkbox` input | `s-text-field label="Ketik RESET"` | |
| `.ov` / `.sheet` overlay | one persistent `s-modal` | See "Modal". |
| `.pick` grid | `s-grid` of `s-clickable` (`s-avatar` + `s-text`) | Selection stays immediate, as today. |
| `.note`, `.rest`, `.sub` | `s-text color="subdued"` / `s-paragraph` | |
| Section dividers, spacing | `s-stack`, `s-box`, `s-divider` | |

## Modal

Replace `openModal(html)` / `closeModal()` / `answerConfirm()` internals with a single `<s-modal id="modal">`
in the body. `openModal(heading, bodyHTML, actions?)` sets `heading`, fills the content, adds
`slot="primary-action"` / `slot="secondary-actions"` buttons when the dialog has a standard
primary/secondary pair (confirm, reset-all), then calls `showOverlay()`. Dialogs with 3+ actions
(selfie, profile, recap) keep a stacked button column in the body. The modal handles backdrop click and
Esc itself; its `hide` event runs the existing "resolve pending confirm as false" logic. Delete the
`.ov` / `.sheet` CSS and the overlay-click branch of the click handler.

## Events

- The global click handler changes from `e.target.closest("button")` to
  `e.target.closest("s-button, s-clickable, button")`. Events from shadow DOM retarget to the host, so
  `data-act` / `data-pt` / `data-undo` / `data-reset` / `data-tab` keep working unchanged.
- The Enter-to-confirm handler keeps keying off `id="rstIn"` on the `s-text-field`; the value is read from `.value`.
- Render functions keep building HTML strings; only the markup they emit changes. Custom elements work in `innerHTML`.

## Layout: phone and iPad

Today the page is a single column capped at 640px, which leaves an iPad mostly empty. Targets: phone
portrait (~390px), iPad portrait (768px) and iPad landscape (1024px+). Layout is driven by CSS
breakpoints on the outer shell plus `s-grid` columns, not by device sniffing.

| | Phone (<700px) | iPad portrait (700–1023px) | iPad landscape (≥1024px) |
|---|---|---|---|
| Page width | full width, 16px gutter | max 880px, centered, 24px gutter | max 1120px, centered, 32px gutter |
| Tabs | full-width row, 3 equal buttons | same | same |
| Jadwal (matches) | 1 column | 2 columns of match cards | 2 columns |
| Klasemen | recap CTA above, standings below | same, standings full width | **two panes**: standings (left, ~2/3) + recap CTA (right, sticky) |
| Pemain cards | 1 column | 2 columns | 3 columns |
| Pick-player modal | 2 columns | 3 columns | 3 columns |
| Modal | `size="base"`, slides as sheet | `size="base"` | `size="base"` |
| Score digits | 48px | 56px | 64px |

Rules for all sizes:
- Touch targets ≥ 44px; the `+ Poin` buttons ≥ 56px tall since they are tapped mid-game.
- Respect `env(safe-area-inset-*)` as now (notch, home bar).
- Orientation change must reflow without a reload (CSS only; no JS width checks).
- The live match card stays first-visible: on 2-column layouts it spans both columns so the scoring buttons are never half-width on a small iPad.

## Standings table

`s-table variant="auto"` renders as a **list on narrow containers** and a real table when wide, so
phone gets the list and iPad gets the full table automatically. The seven columns map to `listSlot`:
name = `primary`, Main/M/K/Game/+– = `labeled` or `inline`, Recap button = `inline`.
The phone list is the largest visual change. If it reads worse than today's grid for 11 players
× 6 numbers, the fallback is to drop *Main* and *Game* from the narrow view. Decide after seeing it rendered.

## Failure mode

The app previously had no script dependency beyond fonts. If `polaris.js` fails to load, `s-*` elements
render nothing and the app is unusable. On `window.load`, if `customElements.get("s-button")` is undefined,
show a plain-HTML notice with a reload button. (State polling already requires network, so no new offline loss.)

## Verification

The repo has no test suite and no build step. Verify by:

1. Headless Chrome screenshots (as in the spike) of each tab, each modal, light and dark, at 390px (phone), 768px (iPad portrait) and 1180px (iPad landscape).
2. Click-through in a real browser: pick player, add point, undo, reset match, reset all (RESET gate), recap open/share/save, tab switching, selfie flow.
3. Check no console errors and that the avatar and dark-mode tokens are covered.

## Out of scope

Scoring rules, API, Redis, recap card artwork (it keeps its own canvas fonts and layout), replacing the toast.

## Open items to resolve while building

- Find the avatar initials color token.
- Confirm `s-banner`, `s-clickable`, `s-section`, `s-grid`, `s-stack` properties against their docs pages as each is used (only modal, table, button, text-field, badge and avatar were read for this spec).
- Confirm dark mode covers `s-section` background, text, subdued text and borders.
