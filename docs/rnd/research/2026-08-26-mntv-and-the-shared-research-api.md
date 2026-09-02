# MusicNerd TV, and why it should be asking us

Read on 2026-08-26 at `xdjs/MNTv@446245b`. This covers the nugget pipeline, the
cache schema, and the artist-resolution path. It is not a full read of the
4,446-line edge function.

## What MNTv is

A React SPA that plays music and surfaces "nuggets", short sourced facts timed
to playback, scaled to three listener tiers. The research happens in one
Supabase edge function, `generate-nuggets`, which:

1. searches YouTube and pulls transcripts
2. fetches artist info from Spotify, Apple Music and Last.fm
3. searches the open web with Exa
4. filters the returned citations for ones that are really about this artist
5. hands the surviving material to Gemini with a "constitution"
6. validates what comes back, then caches it

## What is working, and is genuinely good

**The validation layer is serious.** `validateNuggetQuality` checks for banned
phrases, scores against a constitution, and carries both a
`HALLUCINATED_PUBLISHERS` blocklist and a `KNOWN_REAL_PUBLISHERS` allowlist. It
distinguishes catalogue sources from editorial ones. This is the same instinct
we arrived at separately: a model that has been handed real sources will still
invent a plausible magazine.

**Image selection is multimodal.** Candidate images are fetched, base64'd and
put in front of Gemini so it chooses after actually looking, with Wikipedia and
Commons as fallbacks. That is more careful than anything we do with images.

**Generation is claim-guarded.** `nugget_cache` uses a claim so two clients
asking for the same track do not both pay for a generation, and the last few
commits on the repo are about releasing that claim on every exit path. Someone
has been thinking about concurrency properly.

**The product shape is right.** Facts arrive while the music plays, they carry a
source, and a discovery nugget can name another artist with a button to open
them.

## What is not working

### 1. It has independently rebuilt our research pipeline, including our bugs

`citationMentionsArtistStrict` and `citationMentionsArtistLoose` are MNTv's
version of `sourceRelevance.ts`. `searchExaPages` is `webSearch.ts`.
`validateNuggetQuality` is `sourceVerification.ts`. Two products, two research
stacks, two Gemini bills, two sets of hallucination defences, both maintained by
hand.

The sharpest instance is `resolveRecommendedArtistId`. When a nugget recommends
another artist, MNTv searches Spotify by name, keeps only exact name matches,
and **picks the one with the most followers**:

```ts
const exact = items.filter((a) => String(a.name).trim().toLowerCase() === wanted);
exact.sort((a, b) => (b.followers?.total ?? 0) - (a.followers?.total ?? 0));
return exact[0].id;
```

That is precisely the namesake bug this repo spent the last week fixing. Three
artists in our directory are called Black Dave. Given that name, MNTv sends the
listener to whichever one is biggest, every time, with no way to be right about
the other two. We already solved this: identifier matching through MusicBrainz,
a cross-artist collision guard, and abstention when the name genuinely cannot be
resolved. None of that is available to MNTv.

### 2. There is no connection between the two products at all

A search across the MNTv source for any reference to Music Nerd returns
localStorage keys and event names. Not one call. The two products share a brand,
a subject and a research problem, and nothing else.

### 3. The cache is keyed by track, so nothing accumulates about an artist

`nugget_cache` is `track_id TEXT NOT NULL UNIQUE`. Research done for one track
is invisible to the next track by the same artist. Everything MNTv learns about
an artist is discarded at the track boundary and re-researched from scratch,
at full cost, the next time.

`artist_cache` sounds like the exception but is not: it is a 24-hour TTL over
the Spotify edge function's response. It caches an API call, not knowledge.

### 4. The pipeline is one 4,446-line function

Stages that cannot be separated cannot be tested individually, and the parts
worth reusing (citation filtering, publisher validation) cannot be lifted out.

## What we already have that MNTv needs

`/api/mcp` already exposes `search_artists` and `get_artist` as read-only tools
with no authentication. That is most of the contract already built. `get_artist`
returns the artist's id, name, bio, Spotify and Deezer ids, and every social
link we hold.

What would have to be added for MNTv to depend on it:

- **Lookup by Spotify id.** MNTv always knows the Spotify id of what is playing.
  We store `spotify` on the artist and keep cross-platform mappings in
  `artist_id_mappings`. A `get_artist_by_platform_id` tool turns MNTv's
  namesake guess into an identifier match, which is the whole bug.
- **The knowledge document, the credits and the statements.** We now hold
  verified quotes from an artist's own captions with the post they came from.
  That is nugget-shaped material we can already cite, and it is better sourced
  than anything on the open web because the artist wrote it.
- **Latest releases.** We have `getSpotifyCatalogNames` already.

## What should flow back, and what should not

MNTv researching an artist produces cited web sources. Those are the same shape
as our vault sources, and we already have an authenticated, audit-logged MCP
write path.

The thing to be careful about: **send back the sources, not the prose.** A
nugget is written to be entertaining and is scoped to one track. Our vault
holds sources that our own relevance judge has assessed. If MNTv posts finished
nuggets into artist records we inherit its hallucination risk and its framing.
If it posts the URLs, publishers and quotes it found, those enter the vault as
pending sources and go through the judging we already trust.

That also fixes MNTv's problem in the other direction: sources it found once
become permanent artist-level knowledge rather than dying with the track cache.

## Suggested shape

```
MNTv, on a track:
  1. get_artist_by_platform_id(spotify, <id>)   -> our artist, identified not guessed
  2. if we have research: use it, cite it, skip Exa entirely
  3. if we do not: run its own pipeline, then
     submit_artist_sources(artist_id, [{url, publisher, quote}])
  4. those land as pending vault sources and are judged by our pipeline
```

The first call alone is worth doing on its own: it removes the namesake bug,
costs one request, and requires no write path or new trust boundary.

## For our own artist profile

Pete's other question was whether the profile could surface facts and latest
releases the way MNTv does. We are closer to that than the knowledge document
suggests. `artist_social_credits` now holds verified statements, each one a
direct quote with the post it came from. "It's my best song I've made to date"
is a nugget. It needs no web research, no hallucination guard, and no publisher
allowlist, because the artist said it and we kept the receipt.
