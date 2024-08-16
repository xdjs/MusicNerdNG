// {
//     name: string,
//     spotifyId: string,
// }
import exp from 'constants';
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

export async function getEnabledLinks( id ) {
    const artistQuery = new Parse.Query('Artist');
    artistQuery.equalTo("lcname", id);
    const { findResult: artistResult } = await encodeParseQuery(artistQuery);

    if (artistResult.length <= 0) {
        return {
            props: {
                isNotFound: true
            }
        }
    }

    const enabledLinksQuery = new Parse.Query("UrlMap");
    const { findResult: enabledLinks } = await encodeParseQuery(enabledLinksQuery.addAscending("cardOrder"));

    return { enabledLinks };
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

