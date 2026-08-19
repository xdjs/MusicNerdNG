"use client";

/** The Music Nerd mark, breathing, as a loading indicator.
 *
 *  The mark is a face — a circle wearing glasses — so spinning it the way a
 *  generic spinner spins looks wrong. It scales and brightens instead, which is
 *  the same "clearly alive rather than mechanical" idea behind the onboarding
 *  progress pill's breathing glow (see .animate-onboarding-progress-breathe).
 *
 *  Uses musicNerdLogo.png, not music_nerd_logo_sm.png: the small asset is a
 *  letterboxed mark on a white field, which renders as a white block in dark
 *  mode. This one is square and transparent, so it sits cleanly inline at any
 *  size.
 */
export default function MusicNerdLoader({ size = 16, label = "Working", className = "" }: {
    /** Rendered width and height in px. The asset is square. */
    size?: number;
    /** Announced to screen readers — say what is being waited on where you can. */
    label?: string;
    className?: string;
}) {
    return (
        <span
            role="status"
            aria-label={label}
            className={`inline-flex flex-none items-center justify-center ${className}`}
            style={{ width: size, height: size }}
        >
            <img
                src="/musicNerdLogo.png"
                alt=""
                aria-hidden="true"
                width={size}
                height={size}
                className="animate-music-nerd-loader w-full h-full object-contain"
            />
        </span>
    );
}
