// {
//     name: string,
//     spotifyId: string,
// }
import Parse from 'parse';

export default async function getFeaturedArtists() {
    // Some code 
    Parse.initialize("CaWyhf3u5yoMRusaurJaF82l7VsYiVVuZzD2nOXD",undefined);
    Parse.serverURL = 'https://api-staging.musicnerd.xyz/parse';
    Parse.AnonymousUtils.logIn();
    try{
        const featuredArtists = await Parse.Cloud.run("getFeaturedArtists");
        
        console.log(featuredArtists)
        
        return (featuredArtists)
        
    } catch (e) {
        console.log(e)
    }
}


// get artist

// search 

// login functions 

