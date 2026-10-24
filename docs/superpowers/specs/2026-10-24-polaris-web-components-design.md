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
4. **Keep non-component brand pieces**: the Eater `h1`, and the large Barlow Condensed scoreboard digits.
   There is no Polaris component for a scoreboard, and Polaris has no display typeface.
   All other text uses Polaris typography. *(Assumption — flag if you want Barlow everywhere.)*
5. **Keep the custom toast** (`#toast`), restyled with palette variables. App Home toasts need App Bridge, which isn't available here.
6. **Recap card unchanged.** It is drawn on a canvas from data, not captured from the DOM.

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

## Standings on mobile

`s-table variant="auto"` renders as a **list on narrow screens**, which is where this app is used.
The seven columns map to `listSlot`: name = `primary`, Main/M/K/Game/+– = `labeled` or `inline`, Recap button = `inline`.
This is the largest visual change. If the list layout reads worse than today's grid for 11 players
× 6 numbers, the fallback is to drop *Main* and *Game* from the narrow view. Decide after seeing it rendered.

## Failure mode

The app previously had no script dependency beyond fonts. If `polaris.js` fails to load, `s-*` elements
render nothing and the app is unusable. On `window.load`, if `customElements.get("s-button")` is undefined,
show a plain-HTML notice with a reload button. (State polling already requires network, so no new offline loss.)

## Verification

The repo has no test suite and no build step. Verify by:

1. Headless Chrome screenshots (as in the spike) of each tab, each modal, light and dark, at ~390px and ~640px.
2. Click-through in a real browser: pick player, add point, undo, reset match, reset all (RESET gate), recap open/share/save, tab switching, selfie flow.
3. Check no console errors and that the avatar and dark-mode tokens are covered.

## Out of scope

Scoring rules, API, Redis, recap card artwork, fonts for the `h1` and scoreboard, replacing the toast.

## Open items to resolve while building

- Find the avatar initials color token.
- Confirm `s-banner`, `s-clickable`, `s-section`, `s-grid`, `s-stack` properties against their docs pages as each is used (only modal, table, button, text-field, badge and avatar were read for this spec).
- Confirm dark mode covers `s-section` background, text, subdued text and borders.
