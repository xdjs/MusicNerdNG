"use client"

import { useMemo, useState, useContext } from "react"
import { useFetchArtist } from "@/utils/queries";
import { artistDataType } from "@/app/artist/[id]/page";
import Link from "next/link";
import Styles from "./styles.module.scss"

function SearchBar() {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchString, setSearchString] = useState("");
    const { isLoading, results, isUrl } = useFetchArtist(searchString);
    const [isParsingResults, setIsParsingResults] = useState(false);

    const noArtistsFound = <li style={{ pointerEvents: 'none' }}>No results found 🙁</li>
    const noInput = <li style={{ pointerEvents: 'none' }}>Start typing to search! 😊</li>
    const invalidInput = <li style={{ pointerEvents: 'none' }}>Invalid input, please enter something else</li>

    const parseSearchResults = (results: Array<artistDataType>) => {
        return results.map(result => {
            const handleClick = () => {
                setSearchString(result.name)
            }
            
            return (
                <li key={result.name}>
                    <Link href={`/artist/${result.objectId}`} onClick={handleClick}>
                        <div className={`px-2 py-1 ${Styles.resultWrapper}`}>
                            {result.name}
                        </div>
                    </Link>
                </li>
            );
        });
    };

    const getSearchResults = useMemo(() => {
        if (isLoading) return;
        if (results.length <= 0 && searchString.length <= 0) return noInput;
        if (isUrl) return invalidInput;
        if (results.length <= 0) return noArtistsFound;
        setIsParsingResults(true);
        const searchResults = parseSearchResults(results);
        setIsParsingResults(false);
        return searchResults;
    }, [results]);

    const handleBlur = () => {
        setTimeout(() => {
            setIsSearchOpen(false);
        }, 200); // Delay to ensure the click registers
    };

    return (
        <div className={`${Styles.searchWrapper}`}>
            <input 
                key={"searchbar"} 
                onClick={() => setIsSearchOpen(true)} 
                onKeyDownCapture={() => setIsSearchOpen(true)} 
                onBlur={handleBlur} 
                onChange={(e) => { setSearchString(e.target.value) }}
                value={searchString} // Bind input value to state
                type="text" 
                placeholder="Search for an artist" 
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
