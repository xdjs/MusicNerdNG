---
description: Thursday R&D sweep — write this week's agenda and draft the email to the team
---

Write this week's Music Nerd R&D agenda and create a Gmail draft for Pete to review and send.

Read `docs/rnd/README.md` first if you haven't this session.

## 1. Gather

Find the previous meeting date (newest file in `docs/rnd/meetings/`), then read:

- **What shipped** — `git log --oneline --all --since="<that date>"`. Read diffs where a commit
  message isn't self-explanatory. Merged PRs shipped; local commits on an in-flight branch are
  *in progress*. Don't conflate them.
- **What changed in the shared context** — diffs to `docs/rnd/` and `MEMORY.md` since that date.
  `docs/rnd/decisions.md` is the fastest read for what moved.
- **The last agenda** (`docs/rnd/agendas/`) — anything not discussed **carries forward**, marked
  as carried. On 8/20 the biggest topic on the agenda never got reached; that's the failure mode
  to guard against.
- **The last meeting notes** — what "next week" was supposed to be, so the agenda can report
  against it.
- **`docs/rnd/retro.md`** — every open commitment carries into the retro table with an honest
  status. Don't quietly drop the ones that didn't move.
- **`docs/rnd/research/_scratch/`** — Pete's raw notes from the week. Gitignored, so read it here
  and pull anything that belongs on the agenda. Never quote it verbatim into a committed file.

## 2. Write

`docs/rnd/agendas/YYYY-MM-DD.md`, following `docs/rnd/agendas/_template.md`.

- Demo first inside section 2, then **3 topics maximum**. Carried topics go first among them.
- Every topic: time budget, 3–5 sharp questions, stated goal. The questions are the point —
  they're what lets people arrive with a position instead of forming one live.
- Mark speculative lists as speculative. If a list of options came out of a model rather than out
  of the work, say so, so nobody reacts to it as a proposal.
- Say plainly when something on last week's plan didn't happen. A rosy agenda is worthless.
- Short enough to read on a phone.
- Public repo — check it against "What never goes in" in `docs/rnd/README.md`.

## 3. Draft the email

Create a **draft**. Do not send.

- Recipients: read `docs/rnd/recipients.md` (gitignored). If it's missing, ask Pete rather than
  guessing addresses.
- Subject: `Music Nerd R&D — agenda for <weekday> <Month D>`
- Body: the agenda, minus the template comment block.

## 4. Hand off

Give Pete the file path, confirm the draft is waiting, and remind him to post it to the Music
Nerd Discord before the meeting — Carl's try from 8/20, and his manual step.

Then commit the agenda file.
