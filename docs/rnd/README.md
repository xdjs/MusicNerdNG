# Music Nerd R&D

Shared context for the R&D work — decisions, notes, research, and the weekly meeting record.

This exists because context kept dying in chat threads. Agreed with Carl on 2026-08-20: keep it
in this repo as markdown, so any agent working in the codebase can read it without a separate
system to sync.

## What lives where

```
docs/rnd/
├── README.md              this file — the working agreement
├── decisions.md           one line per decision → links to the meeting
├── retro.md               keep / fix / try + open commitments
├── agendas/               _template.md + YYYY-MM-DD.md
├── meetings/              YYYY-MM-DD.md
├── events/                roundtable + showcase: concepts, run of show, recaps
├── research/
│   ├── inbox.md           links + one line on why
│   ├── _scratch/          GITIGNORED — Pete's raw notes
│   └── YYYY-MM-DD-topic.md
└── notes/
    ├── claude/
    └── codex/
```

| Path | What goes in it |
|---|---|
| `decisions.md` | One line per decision, newest first, linked to where it was made. Answers "what's our position on X" without reading every meeting in order. Open questions live at the bottom. |
| `retro.md` | Running keep / fix / try, plus open commitments and who owns them. Appended weekly, carried until closed. |
| `agendas/` | One file per Thursday. Written before the meeting, emailed to the team. `_template.md` is the shape. |
| `meetings/` | Synthesized notes from each meeting — decisions, open threads, what didn't get reached, what's next. |
| `events/` | Roundtable and showcase: the concept and who's in the room, the run of show, and afterward what came out of it. |
| `research/` | Competitor teardowns, articles, threads worth keeping. `inbox.md` is the low-friction dump for links. |
| `research/_scratch/` | **Gitignored.** Pete's raw, unedited thinking. Write freely — nobody's reading it but Claude, and none of it publishes. Claude promotes the durable parts into committed research notes. |
| `notes/claude/` | Claude's working notes — reasoning behind a decision, open questions, dead ends worth not re-walking. |
| `notes/codex/` | Codex / ChatGPT notes. Same idea. Separate so it's obvious which agent produced a line of reasoning when two disagree. |

`MEMORY.md` at the repo root keeps its existing job: engineering state (recently shipped, in
progress, backlog, known issues). This folder is the team-and-direction layer. Why a timeout is
38 seconds goes in MEMORY.md. Why we decided to build the thing at all goes here.

Specs and implementation plans keep living in `docs/superpowers/specs/` and
`docs/superpowers/plans/`. Link to them from here rather than restating them.

**Artist test sessions:** findings go in `research/` as
`YYYY-MM-DD-artist-test-<name>.md` — what broke, what surprised them, what they said unprompted.
Raw session notes go in `_scratch/`. Only name an artist if they've agreed to it; the default is
initials or nothing. They agreed to try the product, not to a public writeup.

## What never goes in

`xdjs/MusicNerdWeb` is a **public repo**. Everything committed here is world-readable.

- **No raw transcripts.** Pete feeds them to Claude directly. They are not committed.
- **No text threads, DMs, email lists, or contact data.**
- **Synthesize, don't quote.** Record the substance of a critique, not the quotable version of
  it. "Curated-listening subscriptions don't hold up without a personal connection to the
  curator" belongs here. However someone actually phrased it in the room does not.
- Nothing about anyone's personal or business situation outside the work.

Attributing a decision to whoever made it is fine and useful — that's how decisions stay
accountable. The rule is about tone and raw material, not about naming people.

**The escape hatch is `research/_scratch/`.** It's gitignored, so nothing in it publishes. If
you're about to soften a thought so it reads well in public, put the unsoftened version there
instead. Claude reads it and promotes what's durable. The rule above should never cost us the
thought itself — only where it lands.

## The weekly loop

1. **Thursday, 10:00 AM — the meeting.** Flow below.
2. **After the meeting** — Pete hands Claude the transcript. They talk through it and **decide
   what to work on next**; that conversation is the point, the filing is bookkeeping. Then Claude
   writes `meetings/YYYY-MM-DD.md`, adds anything settled to `decisions.md`, appends the retro to
   `retro.md`, updates commitments, and files research or notes wherever they belong. Claude
   decides placement without asking; this README is the map it follows.
3. **During the week** — work happens on feature branches as usual. Anything that changes
   direction (a decision, a dead end, a thing an artist did that surprised us) gets written
   down when it happens, not reconstructed on Thursday. Decisions go in `decisions.md` the day
   they're made. Pete dumps raw into `research/_scratch/` and links into `research/inbox.md`
   without thinking about it.
4. **Thursday morning — the sweep.** Run `/agenda`. Claude reads the week's commits, the diffs
   to this folder and `MEMORY.md`, and open commitments in `retro.md`, then writes
   `agendas/YYYY-MM-DD.md` and creates a Gmail draft. Pete reviews and sends.
5. **Pete posts the agenda to the Music Nerd Discord** before the meeting, and the retro after.
   Carl's "try" from 8/20. Manual — Claude has no channel access.

## Meeting flow

60 minutes. Open to people in our network as observers; the AMA is open for everyone.

| | | |
|---|---|---|
| 1 | Vibe check | 0:00–0:05 |
| 2 | Agenda — demo first, then 3 topics (Pete leads) | 0:05–0:32 |
| 3 | Planning for next week (Pete leads) | 0:32–0:42 |
| 4 | Keep / fix / try (CY or Carl leads) | 0:42–0:52 |
| 5 | AMA (CY leads) | 0:52–1:00+ |

The demo at the start and the generated agenda are both retained items from the 8/20 retro.

The retro moved from 0:51 to **0:42** and from five minutes to ten — CY's fix from 8/20 was that
it kept getting squeezed against the end of the call, and on 8/20 it got squeezed out entirely
and happened over text afterward. The agenda block absorbed the cost.

Shape of a good agenda, learned from the first one: every topic carries a time budget, three to
five sharp questions, and a stated goal. The questions are what let people arrive with a position
instead of forming one live. Three or four topics maximum — more than that and nothing gets
decided. See [`agendas/_template.md`](agendas/_template.md).

## Email

Recipients live in `recipients.md`, which is gitignored — contact data doesn't go in a public
repo. Claude drafts, Pete sends.

## Branching

Docs-only commits can go straight to `main` — Carl's call on 8/20. Carl also floated dropping
the staging branch in favor of feature branches merging directly into `main`; not decided yet,
so code still follows the existing flow in `CLAUDE.md`.
