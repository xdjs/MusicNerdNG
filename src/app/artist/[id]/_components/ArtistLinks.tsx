import { ArtistLink } from "@/server/utils/queriesTS";
import { platformType } from "@/server/db/schema";
import { Button } from "@/components/ui/button";
import Image from "next/image";

// Reusable Button Component
const ArtistLinkButton = ({ link }: { link: ArtistLink }) => (
  <Button
    key={link.id}
    className="w-full hover:bg-opacity-60 items-center justify-start space-x-2 h-auto transition-all duration-200 hover:scale-105"  
    style={{ backgroundColor: link.colorHex }}
    asChild
  >
    <a href={link.artistUrl} target="_blank" rel="noopener noreferrer">
      <div className="p-1 bg-white rounded-md">
        <Image
          src={link.siteImage ?? ""}
          alt={link.cardPlatformName ?? ""}
          width={20}
          height={20}
          priority
          className="w-5 h-5"
        />
      </div>
      <span>{link.cardPlatformName}</span>
    </a>
  </Button>
);

export default function ArtistLinks({ links }: { links: ArtistLink[] }) {
  
  const socials = links.filter(link =>
    link.platformTypeList?.includes(platformType.enumValues[0])
  );
  const web3 = links.filter(link =>
    link.platformTypeList?.includes(platformType.enumValues[1])
  );
  const listen = links.filter(link =>
    link.platformTypeList?.includes(platformType.enumValues[2])
  );


  const renderSection = (title: string, linkList: ArtistLink[]) => (
    <section>
      <h2 className="text-lg font-bold mb-2">{title}</h2>
      <div className="grid grid-cols-2 gap-2">
        {linkList.map(link => (
          <ArtistLinkButton key={link.id} link={link} />
        ))}
      </div>
    </section>
  );

  return (
    <section className="flex flex-col gap-4">
      {socials.length > 0 ? renderSection("Socials", socials) : null}
      {web3.length > 0 ? renderSection("Web3", web3) : null}
      {listen.length > 0 ? renderSection("Listen", listen) : null}
    </section>
  );
}
