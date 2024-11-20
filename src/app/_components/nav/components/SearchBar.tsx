"use client"
import { useEffect, useState, useRef, ReactNode, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation'
import { QueryClient, QueryClientProvider, useQuery } from 'react-query'
import { searchForArtistByName } from '@/server/utils/queriesTS';
import { Artist } from '@/server/db/DbTypes';

const queryClient = new QueryClient()

export default function wrapper() {
    return (
        <QueryClientProvider client={queryClient}>
                <SearchBar />
        </QueryClientProvider>
    )
}

export function Skeleton() {
    return (
        <div role="status" className='px-2 py-2'>
            <svg aria-hidden="true" className="w-5 h-5 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
            </svg>
            <span className="sr-only">Loading...</span>
        </div>
    )
}

function Users({
    users,
    search,
    setQuery,
}: {
    users: Artist[] | undefined,
    search: string,
    setQuery: (query: string) => void,
}
) {
    const router = useRouter();

    function navigateToUser(artist: Artist) {
        setQuery(artist.name ?? "");
        router.push(`/artist/${artist.id}`);
    }

    return (
        <>
            {users && users.map(u => {
                return (
                    <div key={u.id} >
                        <Link
                            className="block px-4 py-2 hover:bg-gray-100 cursor-pointer"
                            onMouseDown={() => navigateToUser(u)}
                            href={{
                                pathname: `/artist/${u.id}`,
                                query: {
                                    ...(search ? { search } : {}),
                                }
                            }}
                        >
                            {u.name}
                        </Link>
                    </div>
                )
            })}
        </>
    )
}

interface UserResults {
    users: Artist[]
}

const SearchBar = () => {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [debouncedQuery] = useDebounce(query, 200);
    const searchParams = useSearchParams()
    const resultsContainer = useRef(null);
    const search = searchParams.get('search');

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['userSearchResults', debouncedQuery],
        queryFn: async () => {
            if (!debouncedQuery || debouncedQuery.length < 3) return null;
            const data = await searchForArtistByName(debouncedQuery)
            return data
        },
    })

    const handleInputChange = async (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
    };

    const initialRender = useRef(true)

    return (
        <div className="relative w-full max-w-md z-30 text-black">
            <input
                onBlur={() => setShowResults(false)}
                onFocus={() => setShowResults(true)}
                type="text"
                value={query}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                placeholder="Search..."
            />
            {(showResults && query.length > 2) && (
                <div ref={resultsContainer} className="absolute left-0 w-full mt-2 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {isLoading ? <Skeleton /> :
                        <>
                            {data &&
                                <Users users={data} search={search ?? ""} setQuery={setQuery}/>
                            }
                        </>
                    }
                </div>
            )}
        </div>
    );
};
