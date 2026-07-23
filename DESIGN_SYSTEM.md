# Design system

The public queue uses a ticket-counter aesthetic: a cabinet-ink surface, one marquee
amber action per view, CRT cyan for live controls, and compact ticket numbers. All UI
values are defined as CSS custom properties in `apps/web/src/styles.css`; components use
semantic classes and never introduce standalone visual values.

## Color roles

| Token family                                                             | Purpose                             |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `--color-canvas`, `--color-surface`, `--color-surface-raised`            | Page and ticket surfaces            |
| `--color-ink`, `--color-muted`, `--color-border`                         | Content hierarchy and structure     |
| `--color-amber-*`                                                        | Primary action and up-next emphasis |
| `--color-cyan-*`                                                         | Live and interactive status         |
| `--color-positive`, `--color-neutral`, `--color-caution`, `--color-info` | Done-reason tags                    |
| `--color-danger-*`                                                       | Errors and destructive operations   |

Light and dark values use the same semantic names. The user agent follows system color
preference; no interaction needs a separate theme toggle.

## Type

| Token                            | Role                                     |
| -------------------------------- | ---------------------------------------- |
| `--font-display`                 | Headings and wordmark                    |
| `--font-body`                    | Interface text with system CJK fallbacks |
| `--font-ticket`                  | Ticket numbers and counts                |
| `--text-xs` through `--text-2xl` | Type scale                               |

## Layout and motion

Spacing uses `--space-1` through `--space-8`; dimensions use named `--control-*`,
`--content-*`, and `--ticket-*` tokens. Corners use `--radius-sm`, `--radius-md`, and
`--radius-lg`. Motion is limited to `--duration-fast` and `--duration-normal`; the
reduced-motion media query and device preference disable it without delaying updates.

Content is centred at `--content-width`; the queue board widens to `--content-width-wide`
above the `40rem` breakpoint to host its main-queue / info-rail split (`--rail-width` sizes
the rail — see UI_DESIGN §7.1c).

Stacking uses `--z-overlay` (sticky bars and the queue dock), `--z-floating` (the
draggable board-controls button, which rides above the dock), and `--z-toast` (transient
notifications, above everything).
