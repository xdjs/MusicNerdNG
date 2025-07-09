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
                    setOpenFactTab(value === "topleft" ? "topl" : null);
                }
            }} className="w-full">
                {/* Add your Tabs content here */}
                <TabsList>
                    <TabsTrigger value="topl">Top Left</TabsTrigger>
                    <TabsTrigger value="topr">Top Right</TabsTrigger>
                    <TabsTrigger value="botl">Bottom Left</TabsTrigger>
                    <TabsTrigger value="botr">Bottom Right</TabsTrigger>
                </TabsList>
                
                <TabsContent value="topl">
                    {factContent || "Loading..."}
                </TabsContent>
                {/* Add other TabsContent components as needed */}
            </Tabs>
        </div>
    );
}
