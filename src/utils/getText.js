export const artistWeb3Platforms = ['catalog', 'soundxyz', 'opensea', 'zora', 'mintsongs'];

export const getArtistWeb3Platforms = (parseData) => {
  let web3Platforms = []
  artistWeb3Platforms.forEach(platform => {
    if (!parseData[platform]) return;
    web3Platforms.push((platform.charAt(0).toUpperCase() + platform.slice(1)))
  });
  return web3Platforms;
}


export const getArtistDetailsText = (parseData, spotifyData) => {
  let web3Platforms = getArtistWeb3Platforms(parseData)
  const numSpotifyReleases = ( spotifyData != null && spotifyData.releases != null ) ? spotifyData.releases : 0;
  if (web3Platforms.length <= 0 && numSpotifyReleases <= 0) return "";

  if (web3Platforms.length <= 0 && numSpotifyReleases > 0) return `${numSpotifyReleases} releases on Spotify`;

  const prefix = numSpotifyReleases > 0 ? `${numSpotifyReleases} releases on Spotify; NFT's released on ` : "NFT's released on "
  if (web3Platforms.length < 2) return prefix + web3Platforms[0]

  if (web3Platforms.length > 1)
    web3Platforms[-1] = `and ${web3Platforms[-1]}`
  return prefix + web3Platforms.join(", ")
}