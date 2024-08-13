export default function ArtistProfile({ params }: { params: { id: string } }) {
    return (
        <p>
            this is the artist ArtistProfile
            <br />
            
            <strong>
                {params.id}
            </strong>
        </p>
    )
}