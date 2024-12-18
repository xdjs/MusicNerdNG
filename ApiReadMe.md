## Api Endpoints
Url Structure: `{baseurl}/api/{endpoint}`

**findArtistBySpotifyID**

 - Type: Post Body: `{spotifyID : "yourSpotifyId"}` 
 - Resp: `{result:Artist}` (object ref in schema folder)
 -  Auth: N/A

**findTwitterHandle**

 - Type: Post
 - Body: `{name: "artistName"} | {ethAddress:"yourEthAddress"}` (can be .eth or wallet address)
 - Resp: `{result : "artistSpotifyId"}`
 - Auth: N/A


 **Example Usage**
```
axios.post('https://ng-staging.musicnerd.xyz/', {
  ethAddress: '0xc7A0D765C3aF6E2710bA05A56c5E2cA190C2E11e'
})
  .then(response => {
    console.log('Response:', response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });
```