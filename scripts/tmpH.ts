import dotenv from "dotenv"; import postgres from "postgres";
dotenv.config({ path: ".env.local" });
async function main(){
  const { extractCaptionCredits, creditedCollaborators, selfCredits, captionBearingPosts } = await import("../src/server/utils/socialCredits");
  const sql=postgres(process.env.SUPABASE_DB_CONNECTION!,{max:1});
  const [a]=await sql`SELECT id,name,instagram FROM artists WHERE name='Pete Rango' LIMIT 1`;
  const raw=await sql`SELECT platform, platform_post_id, owner_username, is_own_post, caption, url, posted_at,
    like_count, comment_count, play_count, hashtags, mentions, coauthors, music_title, music_artist
    FROM artist_social_posts WHERE artist_id=${a.id}`;
  const posts = raw.map(r=>({ platform:r.platform, platformPostId:r.platform_post_id, ownerUsername:r.owner_username,
    isOwnPost:r.is_own_post, caption:r.caption, url:r.url,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : "",
    likeCount:r.like_count, commentCount:r.comment_count, playCount:r.play_count,
    hashtags:r.hashtags??[], mentions:r.mentions??[], coauthors:r.coauthors??[],
    musicTitle:r.music_title, musicArtist:r.music_artist })) as any;

  console.log(`${a.name}: ${posts.length} posts, ${captionBearingPosts(posts).length} with prose`);
  const t0=Date.now();
  // DRY RUN: extract only, write nothing.
  const ex = await extractCaptionCredits(posts, a.name, a.instagram ?? "");
  console.log(`extracted in ${((Date.now()-t0)/1000).toFixed(1)}s -- NOTHING WRITTEN\n`);

  const cc = creditedCollaborators(ex);
  console.log(`=== ${cc.length} CREDITED COLLABORATORS (top 20) ===`);
  for (const c of cc.slice(0,20)) console.log(`  ${c.isHandle?"@":""}${c.subject.padEnd(24)} [${c.roles.slice(0,3).join(" / ")}]  ${c.evidenceUrls.length}`);
  console.log(`\n=== ${selfCredits(ex).length} SELF CREDITS ===`);
  for (const c of selfCredits(ex).slice(0,10)) console.log(`  ${c.role}`);
  console.log(`\n=== ${ex.statements.length} STATEMENTS (first 5) ===`);
  for (const s of ex.statements.slice(0,5)) console.log(`  [${s.topic}] "${s.quote.slice(0,140)}"`);

  // How many of the credited people are artists we already have?
  const handles = cc.filter(c=>c.isHandle).map(c=>c.subject.toLowerCase());
  if (handles.length) {
    const known = await sql`SELECT name, instagram FROM artists WHERE instagram IS NOT NULL AND lower(instagram) = ANY(${handles})`;
    console.log(`\n=== ${known.length} of ${handles.length} credited handles are already artists here ===`);
    for (const k of known) console.log(`  ${k.name} (@${k.instagram})`);
  }
  await sql.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
