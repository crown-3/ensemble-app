A desktop messaging system: a two-pane window, a quiet neutral shell, and one saturated colour reserved for what the user said.

## Principles

- **Content first, chrome second.** Colour belongs to the transcript. The shell stays neutral: `surface-window`, `surface-sidebar`, `ink`.
- **Glass is a layer, not a decoration.** Only the toolbar and the composer bar are glass, because only they sit above scrolling content.
- **Legibility beats translucency.** Start from `surface-glass`. Move toward `surface-glass-clear` only over plain surfaces; fall back to `surface-glass-tinted` whenever the content behind is busy or the user reduces transparency.

## Layout

- Build the window from two panes: a conversation list `sidebar-width` wide on `surface-sidebar`, and the transcript on `surface-window`.
- Run the sidebar edge to edge: flush with the window's top, bottom and leading edge, divided from the transcript by a 1px `separator`. Do not float it as an inset card and do not give it a shadow.
- Span one unified toolbar, `toolbar-height` tall, across both panes on `surface-glass` with `glass-blur`. Put search and compose over the sidebar; the conversation name (`headline`) and call or details actions over the transcript.
- Round the window with `radius-window`. Panes that touch the window edge take no radius of their own.
- Pin the composer to the bottom of the transcript on a `surface-glass` bar with `space-5` padding.

## Colour

- Fill outgoing bubbles with `bubble-sent` and set their text in `on-accent`. Use `bubble-fallback` only for the plain-text channel, and say which channel is active in the composer placeholder, since the two differ by hue alone.
- Fill incoming bubbles with `bubble-received` and set their text in `ink`.
- Use `accent` for exactly four things: sent bubbles, the selected sidebar row, the primary button, the unread dot. Use `accent-text` for links and text buttons, never `accent`.
- Set previews, timestamps and delivery status in `ink-secondary`.
- Use `danger` for a failed send, always with the words "Not Delivered" and an icon.
- Draw focus as a 3px solid `focus-ring`, offset 2px.

## Type

- Set all interface and message text in Asta Sans through the `sans` family; the platform UI face is only the fallback while it loads.
- Asta Sans is a hosted Google Fonts variable face (weights 300 to 800) covering Latin and Hangul. Load it from Google Fonts; this system carries no font files.
- Use weights 400, 600 and 700 only.
- Set message text in `message`, sidebar names in `headline`, previews in `preview` clamped to two lines, and everything about time or status in `meta`.
- Centre day separators in the transcript in `meta-strong`, `ink-secondary`, with `space-6` above and below.

## Shape and spacing

- Round bubbles, the composer field and attachment cards with `radius-bubble`; pad bubbles `space-3` by `space-4`; cap their width at `bubble-max-width`.
- Stack consecutive bubbles from one sender `space-1` apart, and separate sender groups by `space-3`.
- Use `radius-capsule` for toolbar button groups, the search field, badges and avatars; `radius-row` for the sidebar selection.
- Give floating glass controls a 1px `glass-edge`, an inner `glass-highlight` on the top edge and `shadow-glass`.

## Voice

- Write sentence case. Keep status to one or two words: "Delivered", "Read 9:41 AM", "Not Delivered".
- Address the user as "you". Name actions with a verb: "New Message", "Add Photos", "Send".
- No emoji in interface copy; emoji belong to the people in the conversation.

## Iconography

- This system carries no icon set and no logo. Use the host platform's symbol library at regular weight, 15 to 17px in the toolbar, in `ink-secondary` at rest and `accent-text` when active.
