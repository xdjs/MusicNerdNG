export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs'];
export const artistPlatforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs', 'x', 'audius', 'bandisintown', 'ens', 'facebook', 'instagram', 'lastfm', 'soundcloud', 'tiktok', 'youtubechannel'];

export const getArtistSplitPlatforms = (parseData) => {
  let web3Platforms = [];
  let socialPlatforms = [];
  
  artistPlatforms.forEach(platform => {
    const formattedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1);
    if (artistWeb3Platforms.includes(platform)) {
      if (parseData[platform]) {
        web3Platforms.push(formattedPlatform);
      }
    } else {
      if (parseData[platform]) {
        socialPlatforms.push(formattedPlatform);
      }
    }
  });

  return { web3Platforms, socialPlatforms };
}


export const getArtistDetailsText = (parseData, spotifyData) => {
  let web3Platforms = getArtistSplitPlatforms(parseData).web3Platforms
  const numSpotifyReleases = ( spotifyData != null && spotifyData.releases != null ) ? spotifyData.releases : 0;
  if (web3Platforms.length <= 0 && numSpotifyReleases <= 0) return "";

  if (web3Platforms.length <= 0 && numSpotifyReleases > 0) return `${numSpotifyReleases} releases on Spotify`;

  const prefix = numSpotifyReleases > 0 ? `${numSpotifyReleases} releases on Spotify; NFT's released on ` : "NFT's released on "
  if (web3Platforms.length < 2) return prefix + web3Platforms[0]

  if (web3Platforms.length > 1)
    web3Platforms[-1] = `and ${web3Platforms[-1]}`
  return prefix + web3Platforms.join(", ")
}