## Api Endpoints
Url Structure: `{baseurl}/api/{endpoint}`

**findArtistBySpotifyID**

 - Type: POST
 - Body: `{spotifyID: "yourSpotifyId"}`
 - Response: `{result: Artist}` (object ref in schema folder)
 - Auth: N/A
 - Error: Returns 400 if spotifyID is missing, 405 for non-POST requests

**findTwitterHandle**

 - Type: POST
 - Body: `{name: "artistName"} | {ethAddress: "yourEthAddress"}` (can be .eth or wallet address)
 - Response: `{result: "artistTwitterHandle"}`
 - Auth: N/A
 - Error: Returns 400 if both name and ethAddress are missing, 405 for non-POST requests

**findArtistByIG**

 - Type: POST
 - Body: `{ig: "instagramHandle"}`
 - Response: `{result: Artist}` (object ref in schema folder)
 - Auth: N/A
 - Error: Returns 400 if instagram handle is missing, 405 for non-POST requests

**searchArtists**

 - Type: POST
 - Body: `{query: "searchTerm"}`
 - Response: `{results: Array<Artist>}` (combined results from local DB and Spotify)
 - Auth: N/A
 - Error: Returns 400 if query is missing or invalid, 500 for server errors

**add-artist**

 - Type: POST
 - Body: `{spotifyId: "spotifyArtistId"}`
 - Response: `{result: Artist}` (object ref in schema folder)
 - Auth: Required
 - Error: Returns 401 if not authenticated, 400 if spotifyId is missing, 500 for server errors

**Example Usage**
```javascript
// Example for findTwitterHandle
axios.post('https://api.musicnerd.xyz/api/findTwitterHandle', {
  ethAddress: '0xc7A0D765C3aF6E2710bA05A56c5E2cA190C2E11e'
})
  .then(response => {
    console.log('Response:', response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });
```