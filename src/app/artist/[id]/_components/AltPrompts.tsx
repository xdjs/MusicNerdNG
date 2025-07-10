"use client"

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


interface FunFactProps {
    availableFactQueries?: { id: string; name: string; description?: string}[];
    selectedFactQuery: string;
    artistName?: string;
    artistId: string;
    factText: string;
}

export default function funFacts({ artistName, artistId, availableFactQueries = [], selectedFactQuery }: FunFactProps) {
    const [loadingFact, setLoadingFact] = useState(false); //if loading
    const [openFactTab, setOpenFactTab] = useState<'topl' | 'topr' | 'botl' | 'botr' | null>(null); //tab switching
    const [activeFact, setActiveFact] = useState<string>('topl'); //selected fact state switching
    const [factContent, setFactContent] = useState<string | undefined>(); //fact text
    //add some sort of const to check for and store facts w/ each artist

    //openAI querying logic TODO: THIS DOESNT ACTUALLY HAVE A WAY TO PULL A SPECIFIC FACT
    //factContent needs to be a property of the json returned by the openAI query that we make
    //chained if statements to check open fact tab and set the fact we want to that?
    useEffect(() => {
        if(!factContent && !loadingFact) {
            setLoadingFact(true);
            fetch(`/api/PLACEHOLDER/${artistId}`)
                .then(async (res) => {
                    if (!res.ok) throw new Error("shit aint work right");
                    const json = await res.json();
                    setFactContent(json.factText as string);
                })
            .catch(() => setFactContent("shit aint work right"))
            .finally(() => setLoadingFact(false));
        }
    }, [loadingFact, factContent, artistId, ]);

    return (
        <div className="mb-4">
            <Tabs value={activeFact} onValueChange={(value: string) => {
                setActiveFact(value);
                if(openFactTab) {
                    setOpenFactTab(value as 'topl' | 'topr' | 'botl' | 'botr');
                }
            }} className="w-full">
                
            <TabsList className="grid w-full grid-cols-2 grid-rows-2">
                <TabsTrigger value="topl">Lore Drop</TabsTrigger>
                <TabsTrigger value="topr">Behind the Scenes</TabsTrigger>
                <TabsTrigger value="botl">Recent Activity</TabsTrigger>
                <TabsTrigger value="botr">Surprise Me</TabsTrigger>
            </TabsList>
                
                <TabsContent value="topl">
                    <div className="relative">
                        <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
                            {loadingFact === true ? (
                                <p className="text-gray-500 italic">Loading fact...</p>
                            ) : (activeFact ? (
                                <>
                                    <p className="text-black">${activeFact}</p>
                                </>
                                ) : <p className="text-black">Error finding fact</p>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="topr">
                <div className="relative">
                        <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
                            {loadingFact === true ? (
                                <p className="text-gray-500 italic">Loading fact...</p>
                            ) : (activeFact ? (
                                <>
                                    <p className="text-black">${activeFact}</p>
                                </>
                                ) : <p className="text-black">Error finding fact</p>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="botl">
                <div className="relative">
                        <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
                            {loadingFact === true ? (
                                <p className="text-gray-500 italic">Loading fact...</p>
                            ) : (activeFact ? (
                                <>
                                    <p className="text-black">${activeFact}</p>
                                </>
                                ) : <p className="text-black">Error finding fact</p>
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="botr">
                    <div className="relative">
                        <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
                            {loadingFact === true ? (
                                <p className="text-gray-500 italic">Loading fact...</p>
                            ) : (activeFact ? (
                                <>
                                    <p className="text-black">${activeFact}</p>
                                </>
                                ) : <p className="text-black">Error finding fact</p>
                            )}
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
