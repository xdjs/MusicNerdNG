"use client"
import { useMemo, useState, useContext } from "react";
import useFetchArtist from "@/custom_hooks/useFetch";
import { useRouter } from "next/navigation";

function SearchBar({ cbk = () => { } }) {
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchString, setSearchString] = useState("");
    const { isLoading, isError, results, isUrl } = useFetchArtist(searchString);
    const [isParsingResults, setIsParsingResults] = useState(false);
    const router = useRouter();

    const noArtistsFound = <li style={{ pointerEvents: 'none' }}>No results found 🙁</li>
    const noInput = <li style={{ pointerEvents: 'none' }}>Start typing to search! 😊</li>
    const invalidInput = <li style={{ pointerEvents: 'none' }}>Invalid input, please enter something else</li>

    function selectSearchOption(result: any) {
        cbk();
        router.push(`/search/${result.lcname}`)
    }

    const parseSearchResults = (results: Array<any>) => {
        return results.map(result => {
            return (
                <li key={result.name}>
                    <div className={`w-100 px-2 py-1`}>
                        <button className="w-100" onMouseDown={() => selectSearchOption(result)} >
                            <div >
                                <span>{result.name}</span>
                            </div>
                            {result.x &&
                                <span className="secondary-text mt-2">
                                    @{result.x} {result.ens ? "/ " + result.ens: null} 
                                </span>
                            }
                        </button>
                    </div>
                </li>
            )
        })
    }

    const getSearchResults = useMemo(() => {
        if (isLoading) return;
        if (results.length <= 0 && searchString.length <= 0) return noInput;
        if (isUrl) return invalidInput;
        if (results.length <= 0) return noArtistsFound;
        setIsParsingResults(true);
        const searchResults = parseSearchResults(results);
        setIsParsingResults(false)
        return searchResults;
    }, [results])

    return (
        <div className={`flex w-full`}>
            <input 
                onClick={() => setIsSearchOpen(true)} 
                onKeyDownCapture={() => setIsSearchOpen(true)} 
                onBlur={() => setIsSearchOpen(false)} 
                onChange={(e) => { setSearchString(e.target.value) }}
                type="text" 
                placeholder="Search for artist or collector" 
                className={`px-2 py-2 corners-rounded login-check`} 
            />
            <div className={""}></div>
            {isSearchOpen && (
                <ul className={`my-4 corners-rounded column-start-start pl-0`}>
                    {(isLoading || isParsingResults) && (
                    <li className={`px-3`}>
                        <img src="\spinner.svg" alt="missing" />
                    </li>
                    )}
                    {getSearchResults}
                </ul>
            )}
        </div>
    )
}

export default SearchBar;