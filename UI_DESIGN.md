# UI design plan

How the public web app is structured, what each route looks like, and how the queue
board behaves. Backend consequences are collected in the last section and mirrored into
`ARCHITECTURE.md`.

Implementation of actual components follows the `frontend-design` skill
(`/mnt/skills/public/frontend-design`) — this file is the plan that skill builds from.

---

## 1. Principles

- **Mobile-first, thumb-first.** The overwhelming case is one hand, a phone, standing
  next to a cabinet in a bright room. Every primary action lives in the bottom third of
  the screen. Mobile is the single stacked column; wide screens keep that column as the
  dominant element and add an informative rail beside it rather than reflowing into an
  unrelated grid (see §7.1c). The queue is never demoted from lead role.
- **No accounts, but named.** There is no auth for public users. Personalization and
  identity come entirely from device-local storage: at least one **name card is required**
  before acting on a board, and the device's currently-active card is the name attached to
  what it does (§4a). Nothing personal leaves the device except the display name, which is
  public on the board anyway. Crucially, this name is **self-asserted, never verified** —
  it's a social signal for readability and mild accountability, not proof of identity. The
  device-token hash remains the only reliable actor key, kept server-side (§7.7).
- **The queue is glanceable.** Someone should understand their position in under two
  seconds without reading instructions. Status is carried by shape, label, and position
  — not by color alone.
- **Live, and honest when it isn't.** The board updates in real time over SSE. When the
  connection drops, say so; never show stale data as if it were current.
- **Every interaction has a boring fallback.** Drag and swipe are enhancements. Tap
  always works, so nothing depends on a gesture a user can't or won't perform.

---

## 2. Route map

Routing via **React Router v6** (mature, ubiquitous, easy for an agent to reason about).
TanStack Router is the type-safe alternative if we later want route-param typing; not
worth the churn now.

```
/                              Landing — choose a location
/l/:locationSlug               Location — choose a game (with waiting counts)
/l/:locationSlug/g/:gameId     Queue board — the main screen
/cards                         Manage saved name cards (also a global drawer)
/about                         What this is, the no-account explanation, privacy note

/admin                         → /admin/login or /admin/locations
/admin/login
/admin/locations               List + CRUD locations
/admin/locations/:id/games     Games for a location + community note editor
/admin/locations/:id/queue     Live queue incl. done entries, manual clear
/admin/users                   Admin accounts + grants (superadmin only)

*                              Not found
```

Two cross-cutting states that aren't routes: a **connection banner** (live / reconnecting
/ offline) pinned under the header, and an **offline/error boundary** that replaces
content when a route fails to load.

The public tree is deliberately shallow — three taps from landing to joining a queue.
`/l/:slug/g/:id` is the QR-code target for per-cabinet deep links (a "later" feature, but
the URL shape is ready for it now).

---

## 3. Global shell

Present on every public route:

```
┌───────────────────────────────┐
│ ☰  QUEUE                  🎴 3 │   header: menu · wordmark · name-card wallet (count)
├───────────────────────────────┤
│ ● live · updated just now     │   connection banner (color+label+text, not color alone)
├───────────────────────────────┤
│                               │
│           route content       │
│                               │
└───────────────────────────────┘
```

- **☰ menu** opens a drawer: Home, My name cards, About. Keeps the header uncluttered.
- **🎴 wallet** is the name-card count; tapping opens the name-card drawer (§6.3) from
  anywhere, so a user can manage cards without leaving the board.
- **Connection banner** is the single source of truth for realtime health. It's the
  honesty mechanism from Principle 4.

---

## 4. Device-local storage model

All of this lives in `localStorage` under one namespaced key, versioned so we can migrate
the shape later. None of it is sent to the server except where noted.

```ts
// key: "arcadeq.v1"
interface LocalState {
  version: 1;
  deviceToken: string; // UUIDv4, generated once; sent as a header, HMAC-checked
  // server-side. The ONLY field that touches the network.
  cards: NameCard[]; // the user's saved "name cards" — at least one required to act
  prefs: {
    activeCardId: string | null; // the card the device is currently "acting as" (§4a)
    boardLayout: 'list' | 'table' | 'checklist' | 'cards'; // per-device, default 'list'
    boardOrder: 'up_next' | 'as_added'; // arrangement, default 'up_next' (§7.1b)
    showFullDayByDefault: boolean; // default false
    reduceMotion: boolean | 'system'; // default 'system'
  };
}

interface NameCard {
  id: string; // local uuid
  name: string; // validated per §5, max 8 graphemes
  colorSeed: number; // derived from name → stable hue, so a name always looks the same
  autoRequeueDefault: boolean; // pre-fills the "re-join after I play" checkbox (§7.4a)
  createdAt: string;
  lastUsedAt: string; // for sorting most-recent-first
}
```

Design consequences worth noting: because display preferences and name cards are local,
switching devices or clearing storage loses them — that's an acceptable trade for zero
accounts, and `/about` says so. The device token is separate from name cards on purpose:
one device, one token (the real, hidden identity for abuse control and audit), but one or
more name cards (a shared phone at a group outing can hold several people's names).

### 4a. The required card and the active identity

Acting on a board — joining, or marking anything done — requires the device to have at
least one name card and a selected **active card**. Two consequences:

- **First-run onboarding (§6.0).** On first use, before the board is usable, the device
  is asked to create one name card. This is a one-time, one-field step, not an account.
  _Viewing_ a board read-only is not hard-blocked, but the first action prompts card
  creation if somehow none exists (e.g. storage was cleared).
- **Active card = "who I'm acting as."** With multiple cards, one is active at a time. The
  active card's name is what gets attached to this device's actions and shown in the audit
  meta line (§7.7). The wallet (🎴) shows and switches the active card. Joining defaults to
  the active card but lets you pick another in the dialog; switching there updates the
  active card.

The name attached this way is **self-asserted**. It makes the log readable and puts a
visible name next to actions (which, alongside the integrity notice, gently discourages
casual board-meddling), but it is not verified and must never be used for authorization or
treated as proof in a dispute. The server always records the acting device-token hash as
the ground truth (§7.7, §9).

---

## 5. Name rules (shared client + server)

Constraint: **alphanumeric, Chinese/Japanese allowed, common keyboard symbols allowed,
max 8 characters.** This is one Zod schema in `packages/shared`, imported by the join
dialog, the name-card editor, and the server's enqueue endpoint — one definition, no
drift.

```ts
// packages/shared/name.ts
const ALLOWED = /^[ -~\p{L}\p{M}\p{Nd}]+$/u;
// ' -~'  = printable ASCII (letters, digits, and common keyboard symbols)
// \p{L}  = any Unicode letter, including Han / Hiragana / Katakana
// \p{Nd} = decimal digits in any script
// \p{M}  = combining marks (needed by some scripts)
// Emoji, control chars, and zero-width/direction chars are excluded by omission.

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function graphemeLength(s: string): number {
  // count user-perceived characters, so 8 means 8 the way a person counts
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...seg.segment(s)].length;
}

export const nameSchema = z
  .string()
  .transform(normalizeName)
  .refine((s) => s.length > 0, 'Enter a name')
  .refine((s) => ALLOWED.test(s), 'Only letters, numbers, and common symbols')
  .refine((s) => graphemeLength(s) <= 8, 'Max 8 characters');
```

Notes for the build:

- **Count graphemes, not code points or `.length`.** `.length` miscounts CJK-adjacent
  cases and would let some inputs past an 8 that a person reads as longer.
- Normalize to NFC and collapse internal whitespace before both validation and storage,
  so `"Bob "` and `"Bob"` are the same card and the same queue entry.
- The server re-validates with the identical schema. Client validation is UX; the server
  is the boundary. Never trust the length check to have happened on the client.
- Display names are **not unique** — two "Bob"s are allowed and disambiguated by ticket
  number (a decision from `ARCHITECTURE.md`). The card `colorSeed` also gives each name a
  consistent color so a user recognizes their own card at a glance.

---

## 6. Route layouts

### 6.0 First-run onboarding (create your name)

The first time a device opens the app with no name card, a one-step sheet appears before
any board can be acted on. One field, the same validation as everywhere (§5), and a short
line of honesty about what it is.

```
┌───────────────────────────────┐
│  Pick a name for the board    │
│                               │
│  ┌─────────────────────┐ 0/8  │
│  │                     │      │   same rules: letters, numbers, symbols, ≤8
│  └─────────────────────┘      │
│                               │
│  This is saved on your device │
│  and shown on the queue. It's │
│  not an account — anyone can   │
│  pick any name, so play fair.  │
│                               │
│       [ Start queueing ]      │
└───────────────────────────────┘
```

- One field, one button. This is the _only_ gate; after it, the device always has a card
  and is never asked again unless storage is cleared.
- Read-only viewing isn't hard-blocked — the gate is on acting. In practice onboarding
  runs at first app open, so a real user has a card before they reach a board.
- The copy states plainly that the name is unverified and local. That honesty is
  deliberate: it sets expectations and reinforces the integrity norm from the start.
- The card created here becomes the active card (§4a).

### 6.1 `/` — Landing

One job: pick a location. Not a marketing page.

```
┌───────────────────────────────┐
│ ☰  QUEUE                  🎴 3 │
├───────────────────────────────┤
│  Where are you playing?       │   one clear question, sentence case
│                               │
│  ┌───────────────────────┐    │
│  │ Timezone — Margo City │    │   location card: name …
│  │ 4 games · open        │    │   … + game count + open/closed by local tz
│  └───────────────────────┘    │
│  ┌───────────────────────┐    │
│  │ Round1 — Senayan      │    │
│  │ 6 games · open        │    │
│  └───────────────────────┘    │
│                               │
│  [ search / filter ]          │   only appears past ~8 locations
└───────────────────────────────┘
```

- Locations sorted by proximity if the browser grants geolocation, else alphabetical.
  Geolocation is opt-in and gracefully skipped — never a wall.
- "open / closed" is computed from the location's own timezone, matching the daily-reset
  logic. A closed location is still tappable (you can look), just labeled.
- Empty state (no locations yet): a plain line explaining the app and, for admins, a link
  to `/admin`. An empty screen is an invitation, not a dead end.

### 6.2 `/l/:locationSlug` — Choose a game

```
┌───────────────────────────────┐
│ ‹ Timezone — Margo City       │   back to landing; location name as title
├───────────────────────────────┤
│  ● live                       │
│                               │
│  ┌───────────────────────┐    │
│  │ Chunithm      ▐▐▐  7   │    │   game name · mini queue-depth bar · waiting count
│  │ Cabinet 1              │    │
│  └───────────────────────┘    │
│  ┌───────────────────────┐    │
│  │ maimai DX     ▐    2   │    │
│  └───────────────────────┘    │
│  ┌───────────────────────┐    │
│  │ Wangan (down)     —    │    │   inactive game: dimmed, no count, still listed
│  └───────────────────────┘    │
└───────────────────────────────┘
```

- The **waiting count per game** is the key affordance here — it's what lets someone
  choose the shortest line. It comes from the location payload (see backend §9), and
  updates live.
- The mini bar is a compact glance at depth; it's redundant with the number, on purpose.
- Cabinets of the same game are separate rows (separate `games` records with a
  `cabinet_label`), each with its own queue.

### 6.3 `/cards` and the name-card drawer

Same content in two presentations: a full route for management, and a slide-over drawer
(the 🎴 wallet) for quick use mid-queue.

```
┌───────────────────────────────┐
│  My name cards                │
│  Saved on this device only.   │   the privacy fact, stated where it matters
│                               │
│  ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ アカ  │ │ Bob  │ │ 小明  │   │   cards show name in their stable color
│  │  ⋯   │ │  ⋯   │ │  ⋯   │   │   ⋯ = rename / delete
│  └──────┘ └──────┘ └──────┘   │
│                               │
│  [ + Add a name card ]        │
└───────────────────────────────┘
```

- Cards are reorderable; most-recently-used floats up automatically on the board.
- Delete is immediate with an undo toast, not a confirm dialog (low stakes, local only).

---

## 7. The queue board — `/l/:slug/g/:gameId`

The screen everything else exists to reach.

### 7.0 Board mode (admin-toggleable, per game)

There are two ways the head of the line is handled. This is a per-game setting an admin
picks (`games.board_mode`, backend §9); the rest of the board is identical either way.

**`self_serve` — the default.** There is no separate "now playing" slot to maintain. The
flow is:

1. A player joins the queue.
2. When their turn comes, they mark **themselves** as playing — their entry crosses out.
   That single act _is_ the completion; nothing has to be cleared afterward.

The top waiting entry is implicitly "up next" and gets a subtle emphasis, but it is a
normal row, not a special slot. Because finishing and clearing are the same action, the
board never accumulates stale state and needs no janitor. This is why it's the default.

**`now_playing` — opt-in.** A distinct "Now playing" card sits above the waiting list.
When the current player finishes, that slot must be explicitly cleared (by the player or
an admin), which promotes the next in line. Clearer for venues that want an unambiguous
"who is on the machine right now," at the cost of that recurring clear step. Offered
because some arcades will prefer it; not the default because the clearing is exactly the
tedium we're avoiding.

Everything below (§7.1–7.6) applies to both modes. Where they differ, it's called out.

### 7.1 Layout (default self_serve mode)

```
┌───────────────────────────────┐
│ ‹ Chunithm · Cabinet 1        │   back to game list; game as title
├───────────────────────────────┤
│ ● live · updated 3s ago       │   realtime freshness (distinct from note timestamp)
├───────────────────────────────┤
│ 📌 Note from staff            │   COMMUNITY NOTE (optional, admin-set)
│ Cab 1 card reader is flaky,   │
│ pay at counter. — updated 14:20│   note's own "last updated" timestamp
├───────────────────────────────┤
│ ⓘ Anyone can update this board.│   INTEGRITY NOTICE (shown when no approval required)
│   Keep it accurate — don't     │
│   change others' entries unfairly.
├───────────────────────────────┤
│ Up next                       │
│  #13  小明        I'm up  ⟩   │   top waiting row, gently emphasized (not a slot)
│  #14  アカ                 ⟩  │   entry rows (default 'list' layout) …
│  #15  Meihua               ⟩  │   … ⟩ = swipe affordance / tap target
│  … latest 10 shown            │
│  ────────────────────────     │
│  #08  Ken   ~~played~~  ✓     │   done entries: strikethrough + labeled status tag
│                               │
│ [ Show full day (23) ]        │   toggle to entire-day view
├───────────────────────────────┤
│ legend:  ✓ played  ⊘ left     │   status legend (icon + word, always visible when …
│          » skipped  • other   │   … done entries are on screen)
├───────────────────────────────┤
│  [ + Join the queue ]         │   primary action, bottom-anchored, thumb zone
└───────────────────────────────┘
```

In `now_playing` mode the only change is the region under the notice: a highlighted
"Now playing: #12 Bob [ Clear ]" card replaces the "Up next" emphasis, and clearing it
promotes the next entry.

### 7.1a What's shown

- **Default: the latest 10 waiting/recent entries**, newest at the bottom. In
  `self_serve` mode the top waiting row carries a lightweight "I'm up" affordance and mild
  emphasis; in `now_playing` mode the head is the separate card described above.
- **"Show full day"** toggles to every entry for the location-local service date,
  including all done ones. The toggle label carries the total count so the jump isn't a
  surprise. This preference is remembered per device (`prefs.showFullDayByDefault`).
- Done entries render with **strikethrough plus a labeled, colored status tag** — the
  label and icon carry the meaning so it survives colorblindness and grayscale. Color is
  the fourth redundant cue, not the only one.

### 7.1b Board order — "up next" vs "as added" (remembered per device)

A toggle that controls how entries are _arranged_, independent of the layout (§7.3,
density) and the full-day (scope) toggles. Stored in `prefs.boardOrder`, default
`up_next`.

- **Up next (default).** Organized for the question "who's next." Waiting entries are
  grouped and prioritized with the top-of-line emphasis; done entries are tucked below a
  divider (and hidden until "show full day"). This is the mockups you've seen.
- **As added.** Strict **insertion order** — entries appear in the exact sequence they
  joined (ticket number ascending), with **no status grouping and no up-next pull-out**. A
  played entry stays struck through _in its original position_ rather than moving. The
  board reads like a running log, so you can see the true interleaving — who has already
  gone versus who is still waiting, in order — and judge your real position relative to
  everyone, not just the people still in line.

```
        up next (default)                 as added (alternative)
  ┌─────────────────────────┐       ┌─────────────────────────┐
  │ Up next                 │       │ In order added          │
  │  #13 小明   ← up next    │       │  #11 Bob    ~~played~~  │
  │  #14 アカ                │       │  #12 大輔   ~~played~~  │
  │  #15 Meihua             │       │  #13 小明   ← waiting    │
  │  ───────────────        │       │  #14 アカ   ~~played~~  │  played, in place
  │  #11 Bob   ~~played~~   │       │  #15 Meihua  waiting    │
  │  #14 アカ  ~~played~~   │       │  #16 Ken     waiting    │
  └─────────────────────────┘       └─────────────────────────┘
   waiting grouped, done below       literal sequence, interleaved
```

Notes:

- Both the reason legend and the meta line (§7.7) work identically in either order.
- `as_added` is most informative with "show full day" on, but the two remain independent;
  with the latest-10 scope it simply shows the last 10 tickets in sequence.
- Purely a client-side arrangement of data already present — no backend change (§9).
- In `now_playing` board mode, `as_added` still shows the current-player card at top (the
  "who's on the machine now" fact is mode-level), with the ordered log beneath it.

### 7.1c Wide-screen layout — queue column plus info rail

On phones the board is one stacked column, and every element keeps the positions described
above. On wide screens (`min-width: 40rem`) the same pieces split into two columns so the
board stops hugging the centre of a large display, **without** demoting the queue:

- **Left, dominant — the queue.** Now-playing card (mode-dependent), the waiting/done
  list, and the status legend. This column takes the flexible remaining width.
- **Right, a fixed-width info rail.** The glance-only, secondary content plus the join
  controls: the cabinet header (game name + cabinet label), the staff community note, the
  open-board integrity notice, and — grouped tightly at the foot of the rail — the active
  name card + **Join queue** button and the drag-a-name-card drop zone, kept adjacent so
  the drag gesture stays a short reach.
- The back-link top line spans the full width above both columns. **There is no anchored
  bottom dock on wide screens** — that sticky bottom bar is a mobile affordance for the
  thumb zone. While scrolling a long list, the compact pinned top bar (which carries its
  own Join button) keeps the action reachable.

This is a rearrangement of the _same_ elements, not a different screen (§1). Nothing is
added or removed across the breakpoint — the mobile stack and the wide split render the
identical set of pieces, so the queue is never reduced to one tile in a symmetric grid.
The floating board-controls button (§7.3) becomes a stationary corner FAB at this width.
Implementation renders the two arrangements from one set of nodes, switched on the
`WIDE_SCREEN_QUERY` media query; widths come from `--content-width-wide` and `--rail-width`.

### 7.1d Sort direction (remembered per device)

The two **chronological** lists — "In order added" (`as_added` mode) and "Completed" (the
done section in `up_next` mode) — carry a small **sort-direction toggle** in their heading
that flips the display between ascending (oldest / lowest ticket first) and descending
(newest first). It is one device-remembered preference (`prefs.sortDirection`, default
`asc`); the two lists never appear together, so at most one toggle shows at a time.

The toggle is deliberately **absent from the priority "Up next" list**, which always leads
with the head of line — reversing "who's next" would defeat the list's purpose. Direction
is applied purely to display order: the "latest N" windowing still runs on ascending order
so it selects the same entries either way, then the shown order flips. No backend change.

### 7.2 Status colors and legend

Four done reasons, each a shape + word + color triple (from the `done_reason` enum). In
`self_serve` mode, a player marking their own turn complete is the common path and maps
to **played** — it's the prominent default in the picker, with the others one tap away:

| Reason  | Icon | Word    | Hue role         | Meaning                          |
| ------- | ---- | ------- | ---------------- | -------------------------------- |
| played  | ✓    | Played  | positive / green | Took their turn                  |
| left    | ⊘    | Left    | neutral / slate  | Withdrew before playing          |
| skipped | »    | Skipped | caution / amber  | Passed over (absent when called) |
| other   | •    | Other   | info / violet    | Anything else                    |

The legend is visible whenever any done entry is on screen. Exact hexes are set at build
time from the palette in §10; the constraint is that the four must be distinguishable in
grayscale by their icons alone.

### 7.3 Display formats (remembered per device)

A small control (in the drawer or a header affordance) switches the entry list between
presentations. Same data, different density:

- **List** (default) — one entry per row, name + ticket, generous tap targets. Best on a
  phone.
- **Table** — ticket / name / status columns, denser; shines on desktop or for long
  full-day views.
- **Checklist** — each entry leads with a checkbox; tapping it is the "done" action.
  Fastest for a staff member clearing a line.
- **Cards** — entries as little name cards echoing the wallet; the most playful, matches
  the drag-to-join interaction visually.

Choice persists in `prefs.boardLayout`. No backend involvement.

### 7.4 Joining the queue

Two ways in, both ending in the same enqueue call:

**A. Dialog form (baseline).**

```
┌─────────────────────────┐
│ Join the queue          │
│ ┌─────────────────────┐ │
│ │ アカ            3/8 │ │   live grapheme counter, inline validation
│ └─────────────────────┘ │
│ your saved cards:       │
│  [ Bob ] [ 小明 ]       │   tap a card to fill the field
│                         │
│ ☐ Re-join after I play  │   auto re-queue opt-in (§7.4a); default off
│                         │
│      [ Add to queue ]   │   active-voice button; produces a "Joined" toast
└─────────────────────────┘
```

Submitting enqueues the name **and** saves it as a name card if it's new. Typing a name
that already exists as a card enqueues without creating a duplicate (matched on the
normalized name). The button carries an `Idempotency-Key` so a double-tap can't double-join.

**B. Drag a name card (enhancement).** On the board, a user drags a card from the wallet
onto the queue drop zone to join. Powered by **dnd-kit** (keyboard-accessible and
touch-aware). Because drag is hard for some users and impossible with some assistive tech,
**tap-to-fill in the dialog is the guaranteed path** and a plain tap on a card offers
"Add to queue" as well. Drag is delight, not a dependency. (Drag-to-join uses the card's
remembered re-queue default; §7.4a.)

Rules enforced (surfaced as friendly inline messages, from backend §9): one active entry
per device per game, an optional per-game max queue length, and a re-join cooldown after
being marked done.

### 7.4a Auto re-queue on played

A checkbox in the join dialog — "Re-join after I play" — lets a player opt to be put back
at the **end** of the line automatically once their turn completes. The point is the
regular who wants to keep cycling through rounds without re-typing their name each time.

Exact behavior:

- The choice is stored on the entry (`auto_requeue`, backend §9), not just in the UI.
- It fires **only when the completion reason is `played`.** Marking the entry `left`,
  `skipped`, or `other` ends the session and never re-queues — leaving means leaving.
- On a `played` completion with the flag set, the server, in the same transaction that
  marks the entry done, creates a fresh **waiting** entry for the same name and device at
  the back of the queue with a new ticket number. Because the old entry is now `done`, the
  one-active-entry-per-device rule is satisfied at every instant.
- The new entry **inherits the flag**, so the player keeps cycling until they stop by
  marking `left` (or any non-played reason). This matches "I want to keep playing rounds"
  rather than "re-queue me exactly once." It's flagged in Open Questions in case one-shot
  is preferred.
- **Guardrails.** Auto re-queue respects `max_queue_len`: if the line is full, the
  re-queue is skipped and the entry simply completes (surfaced as a small "line was full,
  not re-joined" toast if the acting user is the owner). It is **exempt from the manual
  re-join cooldown** — that cooldown exists to stop spam re-joining, and this is a single
  deliberate opt-in, not spam. The tighter open-board cap on marking _others'_ entries
  (§7.5a) still applies to the completion action itself.
- **Remembered per card.** The checkbox's last state is stored as the name card's default
  (`autoRequeueDefault`, §4), so a regular sets it once and it pre-fills next time. Still
  visible and toggigle every join — a default, not a lock-in.

On the board, an entry with auto re-queue on carries a small repeat indicator (a loop
icon) so others can see this player will cycle back — useful context when reading the
line. It's decorative-plus-informative, with an accessible label.

### 7.5 Marking an entry played / done

The core act of the default board. For your **own** entry — the common case, "I'm up" —
this is deliberately fast:

**Self-mark (the primary path).** On your own top-of-line entry, an "I'm up" control (and
swipe, and the trailing check button) marks you **played** in one tap. No reason picker by
default when it's your own entry and the reason is the obvious one — finishing is meant to
be frictionless, since making it tedious is the whole problem we're solving. A small
"changed your mind?" affordance offers Left/Skipped/Other if needed.

**Marking any entry via the picker.** Swiping or tapping the check on any entry (or using
the "…" on your own for a non-default reason) opens:

```
┌─────────────────────────┐
│ Mark #13 小明 as done   │
│                         │
│  [ ✓ Played ]           │   prominent default
│  [ ⊘ Left ]             │
│  [ » Skipped ]          │
│  [ • Other ]            │
│                         │
│  Staff PIN (if required)│   ONLY when this location requires approval for others' …
│  ┌─────────────────┐    │   … entries AND this isn't your own entry
│  └─────────────────┘    │
└─────────────────────────┘
```

Who may edit which entry depends on one per-location admin flag,
`require_approval_for_others` (backend §9):

- **Default — approval off (open board).** Anyone can mark any entry, subject to
  throttling (§7.5a). No PIN field appears. The **integrity notice** (§7.5b) is shown on
  the board whenever this mode is active.
- **Approval on.** You can always mark **your own** entry (matched by device token) with
  no PIN. Marking **someone else's** entry requires the location **staff PIN**; the modal
  shows the PIN field only then. Your own entries never need it.

The client learns which mode applies from the board payload
(`requireApprovalForOthers` + per-entry `mine`), so the PIN field appears exactly when
it's needed and never reveals whether a PIN exists otherwise.

The action is optimistic with rollback: the row strikes through immediately and reverts
with a toast if the server rejects it. Swipe and the check button are enhancements over an
accessible baseline — the picker is reachable by keyboard and screen reader without any
gesture.

### 7.5a Throttling as the open-board guardrail

With approval off, throttling is what keeps an open board honest against rapid
manipulation. Beyond the standard `done` rate limit (`ARCHITECTURE.md` §6), an open board
adds a tighter **per-device cap on marking _others'_ entries** in a short window, so one
device can't sweep the board. Hitting it shows a friendly "you're doing that a lot — give
it a moment" message, not a hard error. Marking your own entry is not subject to the
tighter cap.

### 7.5b Integrity notice (open-board only)

When `require_approval_for_others` is off, a standing notice sits near the top of the
board (see §7.1 wireframe): a short, non-nagging line in the interface's own voice —
"Anyone can update this board. Keep it accurate, and don't change other players' entries
unfairly." It's informational, dismissible per session but re-shown next visit, and never
covers the queue. It disappears entirely when approval is on, because the PIN is doing
that job instead. The wording follows the copy guidance: direct, no scolding, no
exclamation marks.

### 7.5c Location validation for public changes

Locations with an admin-specified latitude/longitude require proximity validation before
every public join or mark-done action, including staff-PIN actions. Locations without
coordinates behave exactly as before. Authenticated actions in the admin console are
always exempt, and the queue remains readable regardless of location permission.

The board requests a high-accuracy position when it loads, with a 15-second timeout and
at most a 30-second browser-cached reading. A compact status card appears near the board
context on mobile and in the wide-screen info rail. It reports checking, confirmed,
permission blocked, unavailable, timed out, unsupported/insecure browser, insufficient
accuracy, and outside-range states. Every non-checking state includes **Check again**;
permission changes and returning to the foreground re-run the check where supported.
Blocked queue actions focus the card rather than silently disabling controls.

Every actual mutation obtains another reading. The reported centre must fall within the
location's configured radius (default 5 metres) and browser accuracy must be 20 metres or
better; accuracy never expands the allowed radius. Dialog join, drag-to-join, one-tap
"I'm up", reason-picker completion, and staff-PIN completion all use the same gate. No
optimistic queue update begins before the local check succeeds, and the API independently
enforces the same rule. Player coordinates are transient and never saved locally or on
the server. They are browser-supplied and can be spoofed, so the feature is an on-site
guardrail rather than strong identity or authorization.

### 7.6 Community note

An optional block of staff-authored text at the top of the board, with its own "last
updated" line. Distinct from the realtime "updated Ns ago" — one is when a human last
edited the note, the other is when the live data last changed. Both matter and they're
labeled differently so they don't read as the same thing.

Set from the admin console (§8), stored per game (backend §9), and hidden entirely when
empty rather than showing an empty frame.

### 7.7 Entry metadata: timestamps and who acted

Each entry carries a small, muted second line recording when it happened and — for
completions — who did it. This is the lightweight audit trail for backtracking and simple
logging.

```
 #14  アカ                              ⟩     ← primary row
      joined 3m ago                             ← meta line (11px, --text-muted)

 #08  Ken   ~~played~~ ✓                       ← done entry primary row
      joined 14:02 · played 2m ago · by アカ    ← meta line: join, done, actor (name/role)
```

What's recorded and shown:

- **Join / rejoin time.** Every entry shows when it entered the line (`created_at`). A
  rejoin from auto re-queue (§7.4a) is a new entry with its own join time; it also links
  back to the entry it came from (`requeued_from`, backend §9) so a player's rounds can be
  traced. If it's a rejoin, the meta line notes it: "rejoined 1m ago · round 3".
- **Done time and actor.** A completed entry shows when it was marked and by whom.

**Who "who" is — a self-asserted name plus a role.** There are no accounts, so
attribution can't be _proven_. Since acting now requires an active name card (§4a), the
meta line shows that card's **name** for player actions — useful and human-readable — but
it is self-asserted, so it's paired with a role that says how the action was authorized:

| Meta line shows | Meaning                                                                  | How it's derived                    |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| self            | The entry's own device marked its own entry                              | acting device-token hash == entry's |
| by ‹name›       | A different device marked it (open board), shown as its active card name | hashes differ, no staff/admin auth  |
| staff           | Marked via the location staff PIN                                        | PIN-authenticated completion        |
| admin           | Marked from the admin console                                            | authenticated admin session         |

For a self-completion the name is redundant with the entry, so it reads "self"; for
someone else's action the claimed name is the informative part. The underlying acting
device-token hash _is_ stored server-side for moderation and backtracking (§9) and is the
only trustworthy key — the displayed name is never used for authorization and should not
be trusted in a dispute. Names are already public on the board, so showing them here leaks
nothing new. Because the whole queue is purged on the 7-day cleanup (`ARCHITECTURE.md`
§7), the log self-expires, consistent with the app's ephemeral design.

**Time format.** One shared formatter, used everywhere a timestamp appears (meta lines,
community note, connection banner):

- under 60 seconds → `"12s ago"`
- under 60 minutes → `"7m ago"`
- otherwise → `"HH:mm"` (24-hour, in the **location's** timezone, not the viewer's, so it
  matches the arcade clock and the community-note stamp)

Since a queue never spans more than one service date, "older than an hour" cleanly means
"show the wall-clock time." Relative labels are refreshed by **one** shared interval
(~10s) that re-renders all visible relative timestamps at once — never a timer per entry.
Absolute `HH:mm` labels don't tick.

---

## 8. Admin portal

The staff-facing side of the app. Same SPA bundle, gated routes under `/admin`, session
auth instead of device tokens. It is not mobile-first the way the public board is — staff
are usually on a desktop at a counter — but it inherits the responsive floor and stays
usable on a phone. Structure and endpoints are in `ARCHITECTURE.md`; this is the screen
spec.

### 8.1 Roles and what they can touch

Two roles (schema: `admin_users.role` + `admin_location_grants`):

| Capability                                 | superadmin | operator         |
| ------------------------------------------ | ---------- | ---------------- |
| Log in / manage own session                | ✓          | ✓                |
| See & edit **all** locations               | ✓          | —                |
| See & edit **granted** locations only      | ✓          | ✓ (their grants) |
| Create/edit/delete locations               | ✓          | —                |
| Edit games, community notes, board mode    | ✓          | ✓ (granted)      |
| Toggle approval + set staff PIN            | ✓          | ✓ (granted)      |
| View live queue, mark entries, clear queue | ✓          | ✓ (granted)      |
| Manage admin users & grants                | ✓          | —                |

Every admin API call is authorized server-side against the session's role and grants; the
UI hides what a role can't do, but hiding is never the security boundary — the server is.

### 8.2 Auth and shell

**`/admin/login`** — email + password. Passwords hashed with argon2. On success, an
httpOnly, SameSite=strict session cookie is set; a CSRF token is issued for state-changing
requests. Failed logins are rate-limited with lockout after repeated failures (M7). No
public sign-up — admin users are created by a superadmin (§8.6) or a seed script.

```
┌──────────────────────────────┐        ┌───────────────────────────────────────┐
│  Queue admin                 │        │ Queue admin   Locations  Users   ⏻ log out│  ← shell (desktop)
│  ┌────────────────────────┐  │        ├───────────────────────────────────────┤
│  │ email                  │  │        │  side nav: locations list             │
│  └────────────────────────┘  │        │  ┌────────────┐  ┌──────────────────┐ │
│  ┌────────────────────────┐  │        │  │ Timezone…  │  │  main panel       │ │
│  │ password               │  │        │  │ Round1…    │  │                   │ │
│  └────────────────────────┘  │        │  │ + add loc  │  │                   │ │
│  [ Log in ]                  │        │  └────────────┘  └──────────────────┘ │
└──────────────────────────────┘        └───────────────────────────────────────┘
```

The shell: top bar with section nav (Locations, Users [superadmin only], log out) and a
left list of locations the account can see. "Users" is absent for operators. On a phone
the side list collapses into a menu.

### 8.3 Locations — `/admin/locations`

List of locations (all for superadmin, granted for operator), each row showing name,
timezone, active state, and game count. Create/edit opens a form:

| Field                       | Notes                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                        | required                                                                                                                                                                                                            |
| Slug                        | URL-safe; auto-suggested from name, editable, uniqueness-checked live                                                                                                                                               |
| Address                     | optional                                                                                                                                                                                                            |
| Timezone                    | **IANA picker (required)** — drives the daily reset; searchable, defaults to the browser's zone as a guess. This is the single most consequential field; label it clearly.                                          |
| Latitude / longitude        | optional numeric pair; entering both enables public-write location validation, clearing both disables it                                                                                                            |
| Location check radius       | positive whole metres, default 5; only applies when coordinates are present                                                                                                                                         |
| Active                      | toggle; inactive locations still resolve but show as closed publicly                                                                                                                                                |
| Require approval for others | toggle (`require_approval_for_others`, default off). Turning it on reveals the staff-PIN field and requires a PIN; a helper line explains this hides the public integrity notice and gates marking others' entries. |
| Staff PIN                   | shown only when approval is on; set/replace, never displayed back (write-only, argon2).                                                                                                                             |

Create/delete are superadmin-only; operators edit within their granted locations. Deleting
a location is a destructive action behind a typed confirmation (its games and today's queue
go with it).

### 8.4 Games — `/admin/locations/:id/games`

Games for the selected location, reorderable (`sort_order`). Each game's editor:

| Field            | Notes                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name             | required                                                                                                                                                                                             |
| Cabinet label    | optional; distinguishes duplicate cabinets ("Cabinet 2")                                                                                                                                             |
| Queue strategy   | shown but **locked to `simple_fifo`** for now — visible so the seam is discoverable, disabled so nobody expects more yet                                                                             |
| Board mode       | `self_serve` (default) or `now_playing` (§7.0), with a one-line description of each so staff understand the trade                                                                                    |
| Max queue length | optional integer; blank = unbounded                                                                                                                                                                  |
| Active           | toggle; inactive games are dimmed and unjoinable publicly                                                                                                                                            |
| Community note   | textarea + visible/hidden toggle + auto-stamped "last updated {time} by {admin}". Plain text, no rich formatting — it's an operational note, not a CMS. Hidden or empty notes don't render publicly. |

### 8.5 Live queue — `/admin/locations/:id/queue`

The same board components as the public side, in an operational skin: **done entries
always shown**, `as_added` order available, and the audit meta line (§7.7) fully visible
including actor. Staff actions:

- Mark any entry played/left/skipped/other (recorded with `done_by_role = admin`).
- Remove a single entry that was added in error (hard delete — distinct from marking done,
  for genuine mistakes; leaves no strikethrough).
- **Clear queue** — the escape hatch. Empties the current service-date queue for this game.
  Because it's destructive, it's behind a confirmation naming the game and count; because
  the queue is ephemeral anyway, it's recoverable only in the sense that people re-join.

All actions stream to public boards over SSE like any other change.

### 8.6 Admin users — `/admin/users` (superadmin only)

Create and manage admin accounts: email, role (superadmin/operator), and for operators the
set of granted locations (`admin_location_grants`). Reset a user's password (issues a
one-time set-password flow or a temporary password — implementation choice at build).
Deactivate rather than hard-delete where possible, so audit references survive their 7-day
window. Absent entirely from an operator's UI and blocked server-side for operators.

### 8.7 Admin-specific safeguards

- CSRF token on every state-changing request; session cookie httpOnly + SameSite=strict.
- Login rate limiting + lockout (M7); generic "email or password is incorrect" (never
  reveal which).
- Destructive actions (delete location, clear queue, delete entry) require explicit
  confirmation; the copy names the exact target.
- The admin bundle is the same origin as the API, so no cross-site cookie complexity.

---

## 9. Backend implications

New or changed server-side work this UI plan introduces. Mirrored into
`ARCHITECTURE.md`'s data model and API surface.

**Shared validation.** The `nameSchema` in §5 moves into `packages/shared` and is the
single validator for enqueue. (Already anticipated; now concretely specified, including
grapheme counting.)

**Queue entry DTO gains `mine: boolean`.** Derived server-side by comparing the request's
device-token hash to the entry's. The board needs it to decide PIN-free self-service vs.
PIN-gated marking of others. Never send raw device tokens to clients — send the boolean.

**Enqueue and entries gain `auto_requeue: boolean`.** The join call accepts it (default
false); it's stored on `queue_entries`. In the strategy's `complete()`, when the reason is
`played` and the flag is set, the same transaction inserts a new waiting entry for the
same name/device at the back of the line, inheriting the flag, subject to `max_queue_len`
and exempt from the manual re-join cooldown (see `ARCHITECTURE.md` §6 and UI_DESIGN §7.4a).
The re-queue logic lives in the queue strategy, so alternative strategies can implement it
differently. Entries expose `auto_requeue` so the board can show the repeat indicator.

**Audit fields for the entry meta line (§7.7).** `created_at` and `done_at` already exist.
Add `done_by_token_hash` (the acting device, hashed — server-side only, the trustworthy
key), `done_by_name` (the acting device's self-asserted active-card name, display only,
validated by `nameSchema`), `done_by_role` (`self | player | staff | admin | system`), and
`requeued_from` (nullable FK to the previous entry, for rejoin lineage and round
counting). The `done` endpoint accepts `actingName?` (the caller's active card) and
`staffPin?`; it stores `done_by_token_hash` from the request, records `done_by_name`, and
derives `done_by_role`. The public entry DTO exposes `createdAt`, `doneAt`, `doneByName`
(or role label), and a `roundNumber` (walked from `requeued_from`) — but **never** the raw
token hashes.

**Acting requires a name.** Server-side, `enqueue` already requires a valid `displayName`;
`done` now requires either `actingName` (for player actions) or staff/admin auth. The
name is validated but never used for authorization — it is display metadata only. This
mirrors the client gate (§4a/§6.0); the server enforces presence and validity so a crafted
request can't skip it, while treating the name as untrusted for any access decision.

**Board payload gains `requireApprovalForOthers: boolean` and `boardMode`.** The first is
the per-location approval flag (default `false` = open board); combined with each entry's
`mine`, the client decides whether a PIN field is needed. `boardMode` is the per-game
`self_serve | now_playing` setting (§7.0) that selects how the head of line renders and
whether a clear step exists. Neither reveals whether a staff PIN exists when approval is
off.

**Optional location-gated public writes.** Add nullable latitude/longitude and a positive
`location_validation_radius_meters` (default 5) to `locations`; a database constraint
requires coordinates as a pair. The board payload exposes `{ required: false }` or the
enabled venue coordinates, radius, and 20-metre accuracy limit. Enqueue and public done
inputs accept an optional position. When coordinates exist, the queue strategy validates
accuracy and strict centre distance after idempotency replay detection but before any new
mutation. Stable 403 codes distinguish missing, inaccurate, and outside readings. Admin
queue endpoints do not accept or require a position, and player positions are never
persisted.

**Read scope parameter.** `GET /api/games/:id/queue?scope=recent|all` (default `recent` =
latest 10). Both scopes are location-local-service-date filtered. Queues are small, so no
pagination.

**Per-game waiting counts on the location payload.** `GET /api/locations/:slug` returns
each game with a live `waitingCount` so the game-selection route (§6.2) can show line
lengths. Recompute/deliver over the same SSE channel so counts stay live.

**Community note storage.** Add to `games`:
`community_note text null`, `community_note_visible boolean default false`,
`community_note_updated_at timestamptz null`, `community_note_updated_by uuid null`.
Returned in the board payload (only when visible). Admin endpoint:
`PUT /api/admin/games/:id/community-note { body, visible }`. A location-level
announcement (across all its games) is a plausible later extension; not built now.

**No backend for name cards or display preferences.** They are device-local by design.
Worth stating explicitly so nobody "helpfully" adds a sync endpoint — the absence is a
privacy property, not an omission. This includes the layout, full-day, and board-order
(`up_next` / `as_added`, §7.1b) toggles: the `as_added` view is just the same entries
sorted by ticket number on the client, so it needs no new endpoint or query param.

**Idempotency on join.** The dialog and drag both send an `Idempotency-Key`; the server
replay behavior from `ARCHITECTURE.md` §6 covers double-tap and drag-drop-twice.

---

## 10. Aesthetic direction (starting point, validated at build)

This section is the aesthetic _thesis_ in prose; the concrete, editable tokens (exact
hexes, type scale, spacing, motion, component recipes) live in `DESIGN_SYSTEM.md`. Keep
the two in sync — this explains the intent, that file is the source of truth for values.

Grounded in the subject rather than a default template. The through-line: **the queue
entry is a ticket, and the board is a modern take-a-number counter crossed with an
arcade high-score table.** The name card is literally a ticket you keep in a wallet.

Proposed compact token system — to be confirmed against the `frontend-design` skill when
components are built, and deliberately _not_ the AI-default cream/serif/terracotta,
black/acid-green, or broadsheet looks:

- **Palette (5):** a deep cabinet-ink base for the board surface, a warm marquee-amber
  as the single accent (join button, active head-of-line), a cool CRT-cyan for live/
  interactive affordances, plus the status set (green/slate/amber/violet from §7.2).
  Amber and cyan are the only two "loud" colors; everything else stays quiet.
- **Type (3 roles):** a display face with mechanical, ticket-counter character for
  headers and the wordmark; a highly legible body/UI face (CJK coverage is mandatory —
  names will be Japanese and Chinese, so the body face must render them well); and a
  **monospace/segmented face for ticket numbers**, so `#13` reads like a counter display.
  The CJK requirement is a real constraint, not a nicety — pick the body face for it
  first.
- **Layout:** a single vertical column on mobile, the queue as a stack of tickets with
  the head pulled out. On wide screens (see §7.1c) the queue keeps that column shape as the
  dominant left element and gains a right-hand **info rail** for the secondary, glance-only
  content — never a symmetric grid that competes with the queue for attention.
- **Signature:** the **ticket** — ticket-number typography, the name-card-as-ticket, and
  the drag-a-ticket-onto-the-board gesture — is the one memorable idea. Spend the boldness
  there and keep the rest disciplined.
- **Motion:** restrained. A new entry slides in; a done entry strikes through and settles.
  A day-rollover clears the board with one deliberate sweep. Respect `prefers-reduced-
motion` (and the local `reduceMotion` pref) throughout. No ambient decoration.

---

## 11. Open questions

- "Latest 10 entries" — is that the 10 most recent by ticket number (current
  interpretation), or the head-of-line plus the next 9 waiting? These differ once there
  are many done entries. Current assumption: 10 most recent by ticket, with the head
  pulled out separately.
- Should the community note support a second, location-wide variant shown across all a
  location's games? Modeled as a later extension for now.
- Drag-to-join on a phone competes with vertical scroll. Needs a press-and-hold to
  initiate, or a dedicated drag handle on the card — resolve during interaction
  prototyping, keeping the tap fallback authoritative.
- Should "Other" as a done reason capture a short free-text note? Currently no, to keep
  the enum clean and avoid a moderation surface on public input.
