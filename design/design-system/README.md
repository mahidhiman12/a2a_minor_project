Nagrik Sahayak is a civic-tech platform where a citizen describes one problem in plain English or Hinglish and a team of AI agents routes it to every department involved, over the Agent2Agent (A2A) protocol, and reports back one combined status.

The visual language is **monochrome and typography-led**, in the tradition of Apple's platforms and Linear: white space, hairlines and type do the work; colour is reserved for status. One system serves two surfaces:

- **Public site** (landing, sign-in, tracking): full-width white and `bg-subtle` sections, large editorial type, centred compositions, the product itself as the hero image.
- **App** (citizen dashboard, operator workspace, agent console): a Settings-style sidebar on `bg-subtle`, a white workspace, grouped lists, thin separators, small status dots.

If a screen needs a value that is not a token, add the token first.

## Principles

1. **Simplicity over decoration.** No gradients, glows, tinted section blocks or illustrations that don't explain something.
2. **Typography over graphics.** Hierarchy comes from size and weight, not colour or boxes.
3. **Whitespace over cards.** Group with space, `bg-subtle` and hairlines. A card (`surface` + `separator` border) is used only when its contents are one object — a complaint window, a canvas, a list.
4. **Colour means something.** Green done, blue active, orange pending, red error. Everything else is black, white and grey.
5. **Quiet motion.** Short, eased, purposeful. Nothing loops except a live dot.

## Content fundamentals

**Voice.** Plain, calm, respectful. The Concierge speaks as "I" and addresses the citizen as "you". Headlines are short declaratives, often two sentences where the second is set in `ink-tertiary` ("One complaint. *Every department that can fix it.*").

- Do: "I've filed this with 2 departments. Water repairs come first."
- Don't: "Your grievance has been duly lodged with the concerned authority."
- Don't: exclamation marks, emoji, "Oops!".

**Hinglish is first-class.** Samples and placeholders mix languages the way people type ("Rohini me bijli nahi hai subah se"). Never correct a citizen's language.

**Casing.** Sentence case everywhere, including buttons and titles. No uppercase eyebrows — eyebrows are `headline-sm` in `ink-tertiary`. Backend status values (`IN_PROGRESS`) appear in sentence case ("In progress") for citizens and verbatim in `mono` for operators.

**IDs.** Complaint, ticket and skill IDs always render in `mono`, copy on click (glass toast "Complaint ID copied"), and are never truncated in the middle.

**Numbers and time.** Relative time for recency ("4 min ago"), absolute IST for ETAs ("Sat 22 Nov, 9:15 am"), tabular figures in tables and stats.

## Visual foundations

### Colour

- Pages are `bg` (white). Alternate landing sections and the app sidebar use `bg-subtle` (#F5F5F7). Dividers are `separator` (#E5E5EA) at 1px.
- Text: `ink` (#1D1D1F) for primary text. `ink-secondary` (#6E6E73) for any secondary text under 21px. `ink-tertiary` (#86868B) only for large text (the grey half of a headline, eyebrows at 17px semibold), placeholders and icons — it is 3.6:1 on white, below the 4.5:1 needed for small text.
- Buttons: primary is a black pill (`primary` / `on-primary`, inverted in dark appearance); secondary is a grey pill (`fill`).
- Status: a 7px dot in `green`, `blue`, `orange` or `red` beside a word in `ink`. Use the `-soft` badge form only where a status must stand out in a dense table. Text in a status colour uses the `-ink` variant.
- Departments are told apart by **icon and name**, never by colour.
- Blue has exactly one non-status job: the `focus` ring and inline text links (`blue-ink`).

### Type

System font first: `-apple-system` / SF Pro on Apple devices, Inter everywhere else (loaded from Google Fonts, weights 400–700). SF Pro itself is not bundled — its licence limits it to Apple platforms. `SF Mono` / JetBrains Mono for IDs.

- Weight 600 for display and titles, 400 for text, 500 for buttons and list emphasis. Never 700+ in the UI.
- Tracking tightens as size grows (`display` −0.015em) and opens slightly for mid sizes (`title3`, `lead` +0.011em), as on Apple platforms.
- Landing: `display` hero, `headline` section heads, `lead` sub-lines, `body` text. App: `title` for page titles, `title3` for groups, `callout` for rows, `footnote` for metadata and navigation.
- Measure: paragraphs ≤ 640px wide; headlines centred on the public site, left-aligned in the app.

### Layout and space

- Public site: text column 980px, grids and product stage 1180px. Sections pad `space-30` (120px), `space-20` on phones. Section heads are centred with `space-16` below.
- App: 240px sidebar on `bg-subtle`, white workspace, content max 1080px, gutters `space-8`.
- Prefer one hairline to one box. Columns are separated by vertical hairlines (department showcase), rows by inset hairlines that start after the icon (grouped lists).

### Shape and depth

- Radii: `radius-md` 12 for inputs, lists and nodes; `radius-lg` 18 for cards; `radius-xl` 28 for canvases and media; `radius-full` for every button, chip, badge and search field.
- Shadows are nearly absent. `shadow-lg` is only for things that float: menus, sheets, dialogs, toasts and product shots.
- Translucent "glass" (`bg` at 72% + 20px blur + 180% saturation) for the top nav, the mobile action bar, map pins and toasts.

### Motion

- Easing `cubic-bezier(0.25, 0.1, 0.25, 1)` everywhere.
- Press: scale 0.97 in `duration-fast`. Hover: one step lighter or darker. Links underline on hover.
- Sections fade up 12px once as they enter view (`duration-slow`). Sheets and dialogs present from the bottom on phones and scale from 0.96 on desktop.
- Live work: the active dot breathes (opacity 1 → 0.35, 1.8s); the active edge in an agent graph draws fine dashes. Nothing else loops.
- `prefers-reduced-motion`: all durations 0, live dots static.

### Focus and states

- Focus: 3px `focus` ring at 60% opacity, 2px offset. Focused inputs switch to `surface` with a `focus` border and a soft 3px halo.
- Disabled: 35% opacity, no pointer events, always with helper text explaining why.
- Loading: shimmering skeletons on `bg-subtle`; agent work shows the execution timeline, never a spinner alone.
- Empty: one icon in `ink-tertiary` (28px, 1.25 stroke), one sentence, one action.

## Iconography

- **Lucide**, 1.5px stroke (1.25px at 26px and up), rounded caps and joins, `currentColor`. 16px in buttons and nav, 17–18px in rows, 26–30px as section marks.
- Departments: Water `droplet`, Electricity `zap`, Roads `construction`, Sanitation `trash-2`. Agents: Concierge `message-circle`, Orchestrator `git-fork`/`workflow`, generic `bot`.
- Icons sit on `bg-subtle` 32px tiles (`radius-sm`) in lists; bare elsewhere. Never coloured except a status icon.
- No logo yet: the name in `headline-sm` beside Lucide `landmark` at 18px. Do not imitate any company's logo or wordmark.

## Using the components

Previews are styled by `components/bundle.css` (`ns-` classes over the token variables) and are reference implementations for the React rebuild described in the frontend architecture section.
