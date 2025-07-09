
// Re-export everything from the modularised implementation located in ./queries
export * from "./queries";


const {youtube_api_key} = process.env;

export type YTStats = {
    id: string;
    title: string;
    subCount: number;
    viewCount: number;
    videoCount: number;
    description: string;

};

 






