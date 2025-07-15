// Re-export everything from the modularised implementation located in ./ (current directory)
export * from "./artistQueries";
export * from "./leaderboardQueries";
export * from "./userQueries";
export * from "./discord";
export * from "./externalApiQueries";
export * from "./openAIQuery";


const {youtube_api_key} = process.env;

export type YTStats = {
    id: string;
    title: string;
    subCount: number;
    viewCount: number;
    videoCount: number;
    description: string;

};

 






