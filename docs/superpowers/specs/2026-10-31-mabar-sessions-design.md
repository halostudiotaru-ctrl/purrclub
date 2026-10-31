# Mabar sessions: fair schedule generator, session history, manual-game recommendations

## Goal

Anyone can start a new "mabar" session by entering a name, the players and a duration. The system generates the matches for that session from the player count, using the current rules (first to 4 games, one deuce, then sudden death), so that every player plays an equal or near-equal number of matches. Sessions are separate containers: each has its own players, schedule, scores and klasemen, and old sessions stay available as history. When adding a manual game, the app recommends the players with the fewest matches.

## Decisions

- **Sessions are separate containers.** One session is active at a time. Older sessions are kept and can be opened read-only or made active again. The current Halloween event becomes the first session; nothing is lost.
- **One court.** Matches are played one at a time, so the existing single "current match" model is unchanged.
- **Duration to matches:** `matchCount = floor(durationMin / slotMin)`, `slotMin` defaults to 30. Allowed: 1 to 30 generated matches.
- **Fairness:** the match count comes from the duration. Players' match counts differ by at most 1. The create flow shows who plays one fewer and suggests a nearby match count that makes everyone exactly equal; the user may accept or ignore it.
- **Players belong to the session.** Names are typed in the create flow. "Ambil dari sesi sebelumnya" copies names and their photos from an earlier session.
- **Roster rules unchanged:** names 1-20 chars, unique case-insensitively, 4 to 20 players (`MAX_PLAYERS = 20`).
- **No PIN or roles**, consistent with the rest of the app. Anyone can create or activate a session.
- **Reset** ("Hapus semua skor", type RESET) restores the active session to its `base` (see Data): scores, manual players, manual games and substitutions are removed.
- Existing features (substitute, manual game, add player, set current match, undo, recap) keep working, scoped to the active session.

## Data and storage

Session state keeps today's shape and adds fields:

```
{ rev, cur, players: string[], matches: [...same as today...],
  name: string, note: string, createdAt: number,
  config: { durationMin, slotMin, startTime: "HH:MM" },
  base: { players: string[], teams: [{a:[p,p], b:[p,p]}] } }
```

- `base` is the session as created (generated teams, initial players). `resetall` rebuilds `players` and `matches` from it.
- Slot time of match `i` (non-manual) = `startTime + i * slotMin`. The hard-coded 17:00 / 30 min is gone from the client.
- `note` is the recap subtitle. New sessions use the creation date (e.g. "Sabtu 31 Okt"). The legacy session keeps "Sabtu 24 Okt · Medco Ampera".

Redis keys:

| Purpose | Key |
|---|---|
| Session index `{active, list: [{id, name, createdAt}]}` (one key, so a poll costs one read for both) | `ht:sessions` |
| Session state | `ht:session:<id>` |
| Photo | `ht:photo:<id>:<p>`, versions in hash `ht:photov:<id>` |
| Lock | `ht:lock:<id>`; list/activate use `ht:lock:sessions` |

**Legacy session** (id `halloween`) keeps the old keys (`ht:state`, `ht:photo:<p>`, `ht:photov`, `ht:lock`) via one key-helper, so no state or photo is copied. When `ht:sessions` does not exist it is created on first read with the legacy session as the only entry and as active. Legacy state lacking the new fields is filled in on load: `name` "Halloween Tennis", `config` `{durationMin: 300, slotMin: 30, startTime: "17:00"}`, `base` = the default 10 players and fixed schedule, `createdAt` = first migration time.

Session ids for new sessions are `s` + base36 timestamp.

## Schedule generator (`lib/schedule.js`, pure functions)

`generate(playerCount, matchCount) -> [{a:[x,y], b:[z,w]}]`, deterministic.

For each match, with `plays[p]` and `lastPlayed[p]` so far:

1. Let the 4th-lowest `plays` value be the boundary. Players with `plays` below it are forced in; the remaining seats are filled from the group tied at the boundary.
2. Among all ways to fill those seats and all 3 team splits of the chosen four, take the lowest cost: `3 * repeated partner pairs + 1 * repeated opponent pairs + back-to-back penalty` (played in the previous match). Ties: longest rest, then lowest player index.

Because the lowest counts are always chosen first, `max(plays) - min(plays) <= 1` holds after every match. The search is small (at most C(20,4) subsets x 3 splits per match, at most 30 matches).

`recommend(playerCount, matches) -> {a, b}` reuses the same selection and split code for manual games. Counts here are each player's total number of matches in the session (finished and still scheduled, including earlier manual games). Ties: fewer finished matches, then longest rest, then lowest index.

`summarize(playerCount, matchCount)` returns the fairness numbers used by the create flow and the session card: per-player base count and how many players play one extra.

## Create flow (client modal, 3 steps)

1. **Pengaturan:** name (default "Mabar <date>", max 40 chars), duration (quick picks 1 / 1,5 / 2 / 2,5 / 3 hours or custom minutes), minutes per match (default 30, 10-120), start time (default now rounded to 5 minutes).
2. **Pemain:** type a name and "Tambah"; remove chips; "Ambil dari sesi sebelumnya" picks a session and copies its names and photos. 4 to 20 players, validated with the roster rules.
3. **Ringkasan:** "N pemain, M match, tiap orang main X-Y game", the players who play one fewer, and a suggestion with nearby perfectly equal match counts. The names come from a dry run of the generator (`op: "preview"`, see API), so the summary shows exactly what "Mulai sesi" will create. "Pakai saran" sets the duration to `M' * slotMin` and returns to the summary. "Mulai sesi" submits.

Perfectly equal needs `4M` divisible by `N`. Suggested counts are the nearest such `M'` below (if at least 1) and above (if at most 30).

On success the new session becomes active and every phone follows it (toast "Sesi aktif: <name>"; a phone cannot tell a new session from an activated old one, so the wording covers both).

## Session history and read-only view

- "Riwayat" lists sessions (name, date, players, matches finished/total, active marker).
- Opening an old session shows its jadwal, klasemen, pemain tab and recap read-only, with a banner "Sesi lama" and a button back to the active session. "Jadikan aktif" makes it the active session.
- While following the active session, if another phone creates or activates a session, this phone switches to it and shows a toast.
- Identity ("Kamu") follows by name across sessions: on a session switch, `me.p` is set to the index of `me.name` in the new roster if present (photo kept), otherwise cleared with the usual pick prompt.

## Fairness display

- Klasemen shows `main done/total` under each name on phones (today the Main column is hidden below 490px). Wider layouts keep the column.
- The session card summarizes fairness from the real current matches ("Tiap pemain 4 game" or "3 orang main 4 kali, 4 orang main 3 kali"), so it stays correct after substitutions and manual games.
- The recap card uses the session `name` and `note` in place of the hard-coded title and subtitle. Rank text uses the real player count (already done).

## Manual-game recommendation

In the "+ Game manual" modal:

- The player list is sorted by total matches ascending, each showing `main done/total`.
- The top four are labeled "Disarankan". "Pakai saran" fills the selection with them, in the suggested team split. It only fills the picks; every pick stays editable before "Mulai game".
- The suggestion is computed on the server with `recommend` and returned in the state payload as `suggest: {a, b}`; the client does not duplicate the logic. A player added inline starts at 0 matches and appears at the top.

## API

- `GET /api/sessions` -> `{ active, sessions: [{id, name, note, createdAt, players, playerCount, matchCount, doneCount}] }`, newest first. `players` (names) feeds "Ambil dari sesi sebelumnya". The counts are computed by reading each session's state; the stored list only holds id, name and createdAt. The list is small, so no cached counts are kept.
- `POST /api/sessions`:
  - preview: `{op: "preview", name, players, durationMin, slotMin, startTime}` runs the same validation and the generator and returns `{matches: [{a, b}], matchCount}` without writing anything.
  - create: `{name, players: string[], durationMin, slotMin, startTime, note?, copyFrom?}` (`note` is the date label the client sends, max 40 chars); validates the rules above (400 on invalid input, 409 on duplicate names), generates the schedule, writes the state, copies photos from `copyFrom` best effort (a copy failure does not fail the creation), sets it active, and returns `{active, sessions}` (the same shape as `GET /api/sessions`); the client then polls the state.
  - activate: `{op: "activate", id}`.
- `GET /api/state?sid=<id>` and `POST /api/state?sid=<id>`: without `sid`, the active session. The payload adds `sid`, `active`, `session: {name, note, config, readOnly}` and `suggest`. Write ops to a session that is not active return 409 "Sesi ini bukan sesi aktif".
- `GET/POST /api/photo?sid=<id>`: same defaulting; the photo index bound stays `MAX_PLAYERS`.

All existing ops (`point`, `undo`, `resetmatch`, `setcurrent`, `substitute`, `addplayer`, `addmatch`, `resetall`) are unchanged apart from reading and writing through the session's keys; `resetall` rebuilds from `base` and drops photos of players beyond `base.players.length`.

## Compatibility and rollout

- Clients from the previous release call the API without `sid`, so they keep working against the active session, and extra payload fields are ignored. They follow a newly active session automatically.
- The localStorage cache holds the last state including its `sid`; it is shown until the first poll (about a second) and then replaced, never merged with another session's data.
- No data migration step: the legacy session reuses its old keys.

## Files

New: `lib/schedule.js`, `lib/sessions.js` (key helpers, legacy migration, create), `api/sessions.js`. Changed: `api/state.js`, `api/photo.js`, `index.html`, `README.md`.

## Testing

- `tests/api/schedule.test.mjs`: for 4-20 players and 1-30 matches, each match has four distinct players, `max - min <= 1`, total slots equal `4 * matchCount`, and the output is deterministic. Partner and opponent repetition is checked on a few fixed cases. `recommend` picks the lowest-total players, handles ties, and picks a split with new partners.
- `tests/api/sessions.test.mjs`: legacy migration (scores, photos and `cur` intact), create validation, activate, write rejection for non-active sessions, photo copy, `resetall` from `base`, and an old client without `sid`.
- `tests/ui/session.test.mjs`: the create flow, the fairness suggestion, switching to a new session on another phone, read-only history, and the manual-game modal showing "Disarankan" and filling four players with "Pakai saran". `fakeapi.mjs` also routes `/api/sessions`.
- The existing suites (12 API, 60 UI) keep passing.

## Out of scope

Multiple courts, deleting or renaming sessions, regenerating a schedule mid-session, a global player roster, self sign-up, and removing a single manual game.
