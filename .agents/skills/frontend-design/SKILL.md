---
name: frontend-design
description: Visual design guidance for building or reshaping UI in this app. Use whenever creating React components, screens, or styling for the arcade queue board — landing, location/game lists, the queue board, dialogs, onboarding, or the admin portal. Covers aesthetic direction, when to reach for the design tokens, and the quality floor every screen must clear.
---

# Frontend design — arcade queue board

Read this before building any UI. It sets the design judgment; the concrete values live
in `DESIGN_SYSTEM.md` (tokens) and `UI_DESIGN.md` (screens and interactions). This skill
tells you *how to decide*; those files tell you *what the values are*.

## Ground every screen in the subject

The subject is people queueing at arcade cabinets on their phones. The design thesis is
**the ticket**: a queue entry is a ticket, the board is a modern take-a-number counter
crossed with an arcade high-score table, the name card is a ticket you keep in a wallet.
Ticket numbers are set in mono like a segment display. Let that thesis drive concrete
choices, not generic decoration.

## Non-negotiable: build from tokens

Every color, size, radius, and duration comes from `DESIGN_SYSTEM.md` tokens. Never
hardcode a hex, px, or ms in a component — editing a token must cascade, and that only
works if nothing bypasses it. If a value you need isn't a token, add it to
`DESIGN_SYSTEM.md` first, then use it.

## Spend boldness once

The ticket is the one memorable element — ticket-number typography, the
name-card-as-ticket, the drag-a-ticket-to-join gesture. Spend the visual risk there and
keep everything else quiet and disciplined. Amber is the marquee accent, used sparingly
(one primary action per view); cyan is the CRT interactive/live color; the status set is
functional. Cut decoration that doesn't serve the brief.

## Avoid the templated defaults

Don't drift toward the looks that read as AI-generated regardless of brief: cream
background + high-contrast serif + terracotta accent; near-black + single acid-green
accent; broadsheet hairline-rule columns. The brief already picked a direction — follow
`DESIGN_SYSTEM.md`. If an edit starts looking like one of those defaults, it's drifting
away from the subject.

## Typography carries personality

Three roles (see `DESIGN_SYSTEM.md` §2): a characterful display face used with restraint,
a highly legible body face, and a mono face for ticket numbers. The body face **must have
full CJK coverage** — player names will be Japanese and Chinese. This is a hard constraint;
pick the body face for it first.

## Motion is a small vocabulary

New entry pops/slides in; a done entry strikes through and settles; day-rollover clears
the board with one deliberate sweep. That's all. No ambient animation. Always respect
`prefers-reduced-motion` and the local `reduceMotion` pref — transforms and fades off,
state still updates instantly.

## Copy is design material

Sentence case, active voice, plain verbs. A control says what it does ("Add to queue," not
"Submit") and keeps the same word through the flow (button "Publish" → toast "Published").
Errors explain what happened and how to fix it, in the interface's voice, never
apologizing or vague. Empty states invite an action. The integrity notice and the
"self-asserted name" copy are load-bearing — keep them honest and calm, not scolding.

## Quality floor (every screen)

- Mobile-first; primary action in the bottom third, reachable by thumb.
- Design tokens only; light and dark themes both derive from the same semantic tokens.
- WCAG AA contrast; status meaning never by color alone (icon + label + color).
- Visible keyboard focus on everything interactive; tap targets ≥ 44px.
- Every gesture (swipe, drag) has a tap/keyboard equivalent.
- `prefers-reduced-motion` respected.

## Process

Plan before building: name the concrete screen, its one job, and how the ticket thesis
shows up on it. Check the plan against these principles — if a part reads like a generic
default, revise it and say why. Then build to `UI_DESIGN.md` and `DESIGN_SYSTEM.md`
exactly, deriving every value from tokens.
