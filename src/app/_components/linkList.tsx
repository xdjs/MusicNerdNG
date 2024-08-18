import { artistDataType } from "@/app/artist/[id]/page";
import { link } from "fs";
import Link from "next/link";

function PlatformLink({ link, siteName }: { link: string, siteName: string}) {
    return (
        <li className={`mb-5`}>
            <Link href={`${link}`} target="blank" className="row-center-start">
                <div className={`row-center-center corners-rounded mr-3`}>
                    <img src={`/siteIcons/${siteName.toLowerCase()}_icon.png`} className="" alt="" />
                </div>
                <label>{siteName.charAt(0).toUpperCase() + siteName.slice(1)}</label>
            </Link>
        </li>
    )
}

export default function LinkList({siteNames, artistData}: {siteNames: Array<string>, artistData: artistDataType}) {
    return (
        // <ul className="text-black flex flex-col gap-4 items-center">
        //     {siteNames?.map(siteName => {
        //         const parseData = ;
        //         return ( 
        //             PlatformLink()
        //         )
        //     })}
        // </ul>
        "return"
    )
}