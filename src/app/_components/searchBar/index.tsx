"use client"

import { useMemo, useState, useContext } from "react"
import { useFetchArtist } from "@/utils/queries";
import { artistDataType } from "@/app/artist/[id]/page";
import Link from "next/link";
import Styles from "./styles.module.scss"


function SearchBar() {
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchString, setSearchString] = useState("");
    const { isLoading, isError, results, isUrl } = useFetchArtist(searchString);
    const [isParsingResults, setIsParsingResults] = useState(false);

    const noArtistsFound = <li style={{ pointerEvents: 'none' }}>No results found 🙁</li>
    const noInput = <li style={{ pointerEvents: 'none' }}>Start typing to search! 😊</li>
    const invalidInput = <li style={{ pointerEvents: 'none' }}>Invalid input, please enter something else</li>

    const parseSearchResults = (results: Array<artistDataType>) => {
        return results.map(result => {
            return (
                <li key={result.name}>
                    <div className={`px-2 py-1`}>
                        <Link href={`/artist/${result.objectId}`} className="w-100" >
                            <div >
                                <span>{result.name}</span>
                            </div>
                            {result.x &&
                                <span className="secondary-text mt-2">
                                    @{result.x} {result.ens ? "/ " + result.ens: null} 
                                </span>
                            }
                        </Link>
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
        <div className={`${Styles.searchWrapper}`}>
            <input 
                onClick={() => setIsSearchOpen(true)} 
                onKeyDownCapture={() => setIsSearchOpen(true)} 
                onBlur={() => setIsSearchOpen(false)} 
                onChange={(e) => { setSearchString(e.target.value) }}
                type="text" 
                placeholder="Search for artist or collector" 
                className={`${Styles.search} px-2 py-2 rounded-md`} 
            />
            <div className={`${Styles.searchBackground} ${!isSearchOpen ? Styles.hidden : ""}`}></div>
            {isSearchOpen && (
                <ul className={`${Styles.searchResults} my-4 rounded-md column-start-start pl-0 ${Styles.cursorHidden}`}>
                    {(isLoading || isParsingResults) && (
                    <li className={`${Styles.loader} px-3`}>
                        <img src="/spinner.svg" alt="" />
                    </li>
                    )}
                    {getSearchResults}
                </ul>
            )}
        </div>
    )
}

export default SearchBar;