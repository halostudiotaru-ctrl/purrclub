# Dynamic roster: substitutions, manual games, manual players

## Goal

Let anyone, from any phone, (1) substitute a player in a scheduled match, (2) add an impromptu doubles game, and (3) add a new player by name. Manual games and manual players appear in the klasemen and each player gets a recap, the same as scheduled ones.

## Decisions

- Substitute: per match, replaces one player; the whole match is credited to the new player. Finished matches cannot be edited. A match with points can be.
- Manual game: doubles, 2 vs 2, any four distinct players, same scoring (first to 4 games, one deuce then sudden death). Appended to the end of the schedule.
- Manual player: name only (1-20 chars, unique case-insensitively), max 20 players. Selfie via the existing flow.
- No PIN or roles, consistent with the rest of the app.
- "Hapus semua skor" (type RESET) restores the original 10 players and schedule, removes manual players, games and substitutions, and deletes manual players' photos.

## Approach

The server owns the roster and match list (single source of truth). The client stops using its own `PLAYERS` and `FIXED` and adopts both from every poll.

## Data

State (Redis `ht:state`): `{rev, cur, players: string[], matches: [{a:[p,p], b:[p,p], games, p, adv, deuceN, sudden, done, hist, manual?}]}`.

Migration: when a loaded state has no `players`, build `players` from the default 10 names and set each match's `a`/`b` from `FIXED`; existing scores, history and `cur` are kept. Match count is `matches.length`, not the constant `M`.

Public payload adds `players` and, per match, `a`, `b`, `manual`.

## Server ops (`POST /api/state`, under the existing lock)

| op | input | rules |
|---|---|---|
| `substitute` | `i, side (0/1), slot (0/1), p` | match not done; `p` valid and not already in match |
| `addplayer` | `name` | trimmed 1-20 chars; unique; roster < 20; returns new index |
| `addmatch` | `a:[x,y], b:[z,w]` | four distinct valid players; appended with `manual: true` |
| `resetall` | `confirm: "RESET"` | restores defaults, clears `cur`, deletes photos of indexes >= 10 |

`currentIndex` uses `ms.length`. `api/photo.js` accepts `0 <= p < 20`.

## Client

- `PLAYERS`, `N`, `M` come from state; `adopt` takes `players` and matches (with teams). The localStorage cache is keyed to a new version and no longer requires 10 matches.
- Unfinished match cards get "Ganti pemain" (modal: pick the player to replace, then the substitute from players not in the match).
- Top of Jadwal: "+ Game manual" (four pickers plus inline "pemain baru") and "+ Pemain baru".
- Manual matches show "Game manual" instead of a time slot.
- Standings and recap are already built from finished matches; they iterate the dynamic roster. The "4 match" note and "Peringkat dari 10" use real counts.

## Testing

- Throwaway node script with an in-memory Redis stub: ops and their rejections, legacy-state migration, `resetall`, photo bounds.
- Playwright (`tests/ui`, existing harness): substitute modal, manual game, manual player appears in klasemen with a working recap. Existing 56 tests must keep passing.

## Out of scope

Singles, custom game targets, renaming players, removing players or manual games individually.
