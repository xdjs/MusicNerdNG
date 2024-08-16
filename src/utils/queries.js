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
import { useEffect, useState } from "react";

const ARTISTLIMIT = 12;

export const useFetchArtist = (searchString) => {
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState([])
    const [isError, setIsError] = useState(null);
    const [isUrl, setIsUrl] = useState(false);

    const isStringUrl = (input) => {
        input = input.trim().toLowerCase();
        
        if (input.startsWith('http://') || input.startsWith('https://')) {
            return true;

        }
        
        const commonTlds = ['.com', '.org', '.net', '.edu', '.gov'];
        if (commonTlds.some(tld => input.includes(tld))) {
          return true;
        }
        
        if (input.startsWith('www.') && input.substr(4).includes('.')) {
          return true;
        }
        
        return false;
    };

    useEffect(() => {
        const fetch = async () => {
            try {
                // Reset search results before query
                setResults([]);

                if (searchString.length < 1) {
                    isLoading(false);
                    return;
                }
                
                if (isStringUrl(searchString)) {
                    setIsUrl(true);
                    return;
                }
                else {
                    setIsUrl(false);
                }

                setIsLoading(true);

                // Search for web3 artists
                
                const web3ArtistsResults = await Parse.Cloud.run('search', { 'q': searchString });;
                

                setResults(web3ArtistsResults);
                setIsLoading(false);
            } catch (e) {
                setIsError(true);
            }
        }
        const fetchData = setTimeout(() => {
            fetch();
        }, 500)


        return () => {
            clearTimeout(fetchData);
            setIsLoading(false);
        };
    }, [searchString])


    return { isLoading, isError, results, isUrl }
}

// login functions 

