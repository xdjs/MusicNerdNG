import { artistDataType } from "@/app/artist/[id]/page";
import { link } from "fs";
import Link from "next/link";
import { getEnabledLinks } from "@/utils/queries"
import { useEffect, useState } from "react"; 
import Image from "next/image";

type enabledLinkType = {
    CardDescription: string,
    CardPlatformName: string,
    appStingFormat: string,
    cardOrder: number,
    className: string,
    createdAt: string,
    example: string,
    isEmbedEnabled: boolean,
    isIframeEnabled: boolean,
    objectId: string,
    siteName: string,
    siteUrl: string,
    updatedAt: string,
    isWeb3Site: boolean,
    siteImageUrl: string
}

function isObjKey<T extends object>(key: PropertyKey, obj: T): key is keyof T {
    return key in obj;
}

function PlatformLink({ link, descriptor, image }: { link: string, descriptor: string, image: string}) {
    return (
        <li className={`mb-5 list-none`}>
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid corners-rounded">
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label> {descriptor} </label>
                </div>
            </Link>
        </li>
    )
}

export default function LinkList({support, artistData}: {support: boolean, artistData: artistDataType}) {
    const [artistSites, setArtistSites] = useState<Array<enabledLinkType>>()

    useEffect(()=> {
        const getArtistData = async () => {
            try {
                const allEnabledLinks = await getEnabledLinks( artistData.lcname ) as Array<enabledLinkType>
                setArtistSites(filterLinks(allEnabledLinks))
                
            } catch (error) {
                console.error("Error fetching links", error);
            }
        }

        getArtistData()
    }, [])

    function parseLink( enabledLink: enabledLinkType ) {
        if(isObjKey(enabledLink.siteName, artistData)) {
            return enabledLink.appStingFormat.replace("%@", artistData[enabledLink.siteName].toString())
        }
        return ""
    }

    function filterLinks( enabledLinks: Array<enabledLinkType>) {
        const toDisplayLinks = enabledLinks.filter((site) => {
            if (site.isWeb3Site !== support) return false;
            if (!isObjKey(site.siteName, artistData)) return false;
            if (artistData[site.siteName] === undefined) return false;
            return true;
        })

        return toDisplayLinks
    }

    return (
        artistSites?.map(el => {
            return (<PlatformLink key={el.siteName} descriptor={el.CardDescription.replace('%@', el.CardPlatformName)} link={parseLink(el)} image={el.siteImageUrl} />)
        })
    )
}