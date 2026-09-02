# Pre-push checklist

Four checks, written down after a run of PRs where the automated reviewer found
thirteen real defects across three rounds — most of them mine from the round
before, and two of them the *same* mistake reappearing inside its own fix.

They are not general advice. Each one exists because of a specific bug that
shipped, and each is cheap enough that there is no excuse for skipping it.

---

## 1. Mutate the call site, not just the function

**The failure:** a working, well-tested function that nothing calls, or that is
called in a way that cannot work.

- `verifyIdentity` — guards added, tests written for the guards, and the only
  caller passing the flag was the benchmark. The commit message claimed the
  auto-build turned it on. It did not.
- The two-account picker — its unit test mocked the stream to yield two
  candidates, so it passed. Discovery structurally yields at most one per
  platform, so the feature could never fire in production.
- `boilerplateReason` / `diversify` — both mutation-tested green while nothing
  invoked them.
- `sourceUrlForQuestionKey` — the docstring claimed it resolved `collaborator`
  and `music` keys. Neither could ever match, and `music` was not in the pattern.

**The check:** delete or disable the line that *calls* the new code. If the
suite still passes, the test proves the callee and not the feature. A test that
mocks the caller is not evidence the caller exists.

## 2. Diff the rule, not the examples you thought of

**The failure:** verifying a rule change against inputs you chose, then writing
the guarantee down as fact.

- `slug` — "for ASCII input the two classes produce byte-identical output" was
  checked against realistic-looking strings and then against the 922 values in
  the database. Both passed. Neither contained an underscore beside other
  punctuation, which is where it churned. `slug` output *is* the persisted
  `questionKey` under a unique index.
- The shortcode regex — spot-checked on codes without underscores. 29 of 267
  real codes have them, and `Czb_V_lxFMA` resolved to `Czb`.
- Reconstructing `instagram.com/p/<tail>/` — every stored post is `/p/` form
  *today*, so a Reel would have produced a fabricated url. Assuming the input
  shape rather than checking it is the mistake, not the odds.

**The check:** keep the old implementation and compare it against the new one
across enumerated inputs, including the shapes you would not have picked. If
you cannot enumerate them, say "verified against the values we hold", which is
a weaker claim, and write *that* in the comment.

## 3. Re-measure the axis you were not optimising

**The failure:** improving one dimension and silently destroying another.

- The register guards made questions read better and dropped grounded yield to
  **zero** — a dropped question is not replaced by a nicer one, it is replaced
  by "describe your sound".
- Rotation was correct and put the exclusion set in the cache key, which
  removed the cache for the multi-turn path — and the same PR cited that cache
  as the justification for raising temperature.

**The check:** after every behavioural change, re-run the end-to-end
measurement the *previous* change established, not just the one for this
change. `research-benchmark.ts` for discovery; a live `generateGroundedQuestions`
run for the interview. One run would have shown the zero.

## 4. When a fix is "applied at the wrong layer", grep every other layer

**The failure:** fixing the instance you were shown while the same shape sits
untouched next door.

- `excludeKeys` filtered the result instead of the pool. The fix filtered after
  truncation — the identical mistake, in the PR that fixed it.
- "Already have it" gates: found three, shipped, and there were five. Two read
  `artist[col]` directly so the first grep missed them.
- `slug` vs `unicodeSlug`: the credit signal was fixed and five call sites were
  left behind.

**The check:** name the shape ("filtered after truncating", "reads a stale
snapshot", "ASCII-only class") and grep for the shape, not the symptom. Fix the
shared helper where one exists — it is how the `slug` fix reached six call
sites without churning a single stored key.

---

## Also true, and cheaper than any of the above

- **Measure whether the case happens before writing code for it.** A
  containment exemption was added to the co-presence guard for a hypothetical
  and reverted after measuring: across 714 stored credit rows it fired zero
  times, and it opened the hole the function exists to close.
- **Findings cluster in whichever part of a batch was done fastest.** That has
  been true of nearly every one of these.
- **A comment that overclaims is a defect.** Several of these were caught by
  reading a docstring against its own code, and several were *caused* by
  writing the docstring first and trusting it afterwards.
