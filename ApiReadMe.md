## Api Endpoints
Url Structure: `{baseurl}/api/{endpoint}`

**findArtistBySpotifyID**
Type: Post
Body: `{spotifyID : "yourSpotifyId"}`
Resp: `{result: Artist}` (object ref in schema folder)
Auth: N/A

**findTwitterHandle**
Type: Post
Body: `{name: "artistName"} | {ethAddress: "yourEthAddress"}` (can be .eth or wallet address)
Resp: `{result : "artistSpotifyId"}`
Auth: N/A
