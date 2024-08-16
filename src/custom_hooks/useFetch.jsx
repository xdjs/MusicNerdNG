import { useEffect, useState } from "react";

// Number of artists that will appear in the search results
const ARTISTLIMIT = 12;

const useFetchArtist = (searchString) => {
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

export default useFetchArtist;