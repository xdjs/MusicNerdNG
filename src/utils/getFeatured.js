const featuredQuery = (field) => {
    const query = new Parse.Query("Featured").includeAll();
    query.notEqualTo(field, null);
    return query;
}

export const getFeaturedQueries = () => {
    try {
        const artists = featuredQuery("FeaturedArtist");
        return {
            artistQuery: artists,
        }
    } catch (e) {
        return "error";
    }
}