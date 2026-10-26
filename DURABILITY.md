# DURABILITY.md — Durable Product Standard

<!-- PROJECT-AGNOSTIC. Copy this file unedited into every repo.
     Project-specific facts (stack, current phase, exceptions) belong in
     that repo's AGENTS.md, which imports this file with: @DURABILITY.md
     Do not fork or edit per-project — improve it once, upstream, and let
     every repo pick up the change on next pull. -->

## Prime Directive

We build for the 10-year horizon, not launch week. Prefer decisions that **compound** (accumulated user data, community, reputation) over decisions that **spike** (growth hacks, engagement tricks, coercive lock-in). If a requested feature conflicts with this file, say so before implementing it — never silently comply.

Evidence base: the longest-lived software products (Skyrim, Minecraft, Stardew Valley, Terraria, WordPress) all share the same traits — they are systems rather than content, their users build on them, and their makers banked goodwill instead of extracting maximum short-term revenue. A typical game dies in ~2 years; these are all still growing after 10–20.

---

## Pillar 1 — Built to Last

### Systems over content
- The core loop must produce value **without us shipping new content**. If value requires a content treadmill, redesign before building.
- REQUIREMENT: the product is measurably more useful at month 12 than month 1 *because of what the user accumulated* — not because of what we released.

### Become the system of record
- Identify the one dataset the user would most regret losing (call log, ROI ledger, project archive, client history) and make capturing it effortless from day one.
- Stickiness must be **earned** through accumulated value. Never manufactured through export friction, contract traps, or proprietary formats.

### Lindy constraints
- **Problem selection:** only problems older than the internet — finding customers, tracking money, scheduling, communicating, record-keeping, learning, play.
- **Tech selection:** boring by default. Prefer server-rendered pages, plain files, and dependencies you could vendor or live without. Every dependency is a bet on someone else's longevity.
- **Data outlives apps:** store user data in formats readable without our software (SQLite, CSV, JSON, Markdown). No load-bearing third-party API in the core loop without a documented fallback.

### Low-burn economics
- Target fixed running costs one person could carry indefinitely (default ceiling: $100/mo per project; exceeding it requires written justification in that repo's AGENTS.md).
- The product must survive years of modest revenue. No architecture that only makes sense at scale we don't have.

---

## Pillar 2 — Community & User Participation

### The newcomer path — the lifeforce rule

Participation systems die when the inflow of new contributors stops. Existing contributors churn naturally no matter what we do, so the newcomer funnel is the system's metabolism — ease of entry is a requirement, not a nicety.

- REQUIREMENT: a first-time visitor can make their first meaningful contribution in **under 5 minutes**, without creating an account where feasible, and without reading documentation.
- Track **time-to-first-contribution** as a core metric. Every added step is a bug until proven necessary.
- Build a ladder of engagement: one-tap micro-actions (confirm, vote, flag) → small contributions (report, suggest an edit) → trusted roles. Each rung must be visible from the rung below.
- First contributions get fast acknowledgment. Never silently reject a newcomer — explain, and invite a retry. Communities that revert newcomers without explanation kill their own pipeline.
- Plain language everywhere a newcomer looks: no jargon in UI copy, defaults over configuration, examples over docs.
- Maintain a visible "good first contribution" list at all times — easy, genuinely needed tasks.
- Progressive disclosure: complexity may be *available*, never *required*. Any feature that complicates the first-run experience must justify itself in writing.

### Participation surface

- Every project must answer at spec time: **"What can users create here?"** — templates, plugins, reviews, shared configs, public pages, datasets. "Nothing" is a design failure, not an answer.
- Ship extension points in v1, not "later": stable documented data formats, an API or webhooks, theming hooks. Small is fine; absent is not.
- **Credit contributors visibly.** Where money flows through the product, share it with the people creating value on it (the Minecraft Marketplace precedent: pay your creators).
- **Distribution is a product feature.** Build shareable artifacts users *want* to show others — public reports, badges, embeds, before/after pages. Plan the owned channel (content, community, referral loop) in the spec, not after launch.
- Join the community where it already gathers (subreddits, trade groups, Discords, local networks) before building our own forum.

---

## Pillar 3 — Goodwill (trust is an asset — invest in it deliberately)

- **Pricing:** explainable in one sentence. No dark patterns. No surprise repricing. Grandfather early users when prices rise.
- **Leaving:** cancellation and full data export are as easy as signup — one click, no retention gauntlet, no guilt screens. People who stay should stay because they want to.
- **Mistakes:** public changelog; when we break something, acknowledge fast, fix free, explain plainly. Goodwill is the reserve that lets us survive our inevitable bad release.
- **No engagement bait:** no fake urgency, countdown timers, streak guilt, or notification spam. No metric that rewards attention without user benefit.
- **No selling or leaking user data. Ever.**
- **Overdeliver asymmetrically:** ship occasional free value — an update, a report, a tool — with no ask attached.
- **The read-aloud test:** every monetization and retention decision must survive being read aloud, verbatim, to our best customer.

---

## Definition of Done — durability checklist

Ship only when every box is checked:

- [ ] Delivers value with zero new content from us for 6+ months
- [ ] The system of record is identified and working — the user accumulates something they'd miss
- [ ] Users can create or contribute something visible to at least one other person
- [ ] A first-time user can complete a meaningful contribution in under 5 minutes, unaided
- [ ] One-click export of all user data in an open format
- [ ] Pricing explainable in one sentence; cancelling as easy as signing up
- [ ] Fixed costs within ceiling; runs unattended for a month without breaking
- [ ] The 10-year story is written down: what compounds, and why year 2 beats year 1

## Red Flags — stop and raise with the founder before building

- Value depends on us shipping content forever
- Retention depends on friction instead of accumulated value
- Contributing requires an account, documentation, or setup before the first small action is possible
- The problem is younger than ~5 years (trend-surfing)
- A dependency, platform, or API we don't control is load-bearing for the core loop
- Any metric that rewards engagement without user benefit
- Anything we'd be uncomfortable explaining to a customer's face

## Claude's Role in Every Repo That Imports This File

- Check every feature request against this file; flag conflicts **before** writing code.
- Prefer the boring implementation; justify any new dependency in the PR description.
- Whenever a new type of user data is added, implement export for it in the same PR.
- When asked for a growth or monetization feature, propose the goodwill-compatible version first.
- Protect the newcomer path: flag any change that adds first-run complexity — first-contribution simplicity outranks power-user convenience.
- If this repo consciously breaks a rule here, that exception is recorded in **this repo's AGENTS.md**, not in this file.
