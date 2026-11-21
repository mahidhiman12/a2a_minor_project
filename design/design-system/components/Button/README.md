# Button
Pill-shaped buttons; a black primary for the main action and a grey secondary for alternatives.

**Variants.** `primary` (`primary` fill, `on-primary` label — black in light, near-white in dark). `secondary` (`fill`). `plain` (text only, for toolbars). `destructive` (`fill` with `red-ink` label).

**Sizes.** sm 28px (tables, toolbars), md 36px (default in the app), lg 48px (public site and citizen flows).

**Consumer provides.** A verb-first, sentence-case label; optional 16px Lucide icon; `loading` (label becomes "Sending…", disabled).

**Behaviour.** Press scales to 0.97 in `duration-fast`; hover steps one shade. Focus ring is `focus`. One primary per view.
