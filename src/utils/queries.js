// {
//     name: string,
//     spotifyId: string,
// }
import Parse from 'parse';

export default async function getFeaturedArtists() { 
    Parse.initialize("CaWyhf3u5yoMRusaurJaF82l7VsYiVVuZzD2nOXD",undefined);
    Parse.serverURL = 'https://api-staging.musicnerd.xyz/parse';
    Parse.AnonymousUtils.logIn();
    try{
        const featuredArtists = await Parse.Cloud.run("getFeaturedArtists");
        
        // console.log(featuredArtists)
        
        return (featuredArtists)
        
    } catch (e) {
        console.log(e)
    }
}

// {
//     name: string,
//     spotifyId: string,
// }
export async function getArtist( id ) { 
    Parse.initialize("CaWyhf3u5yoMRusaurJaF82l7VsYiVVuZzD2nOXD",undefined);
    Parse.serverURL = 'https://api-staging.musicnerd.xyz/parse';
    Parse.AnonymousUtils.logIn();
    try{
        const params = { "objectId": id }
        const artistData = await Parse.Cloud.run("getArtistByObjectId", params);
        
        // console.log(artistData)
        
        return (artistData)
        
    } catch (e) {
        console.log(e)
    }
}

// search 

// login functions 

