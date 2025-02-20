"use client"

import { useState, useEffect } from "react";

export default function SlidingText({ items, interval = 1000 }: { items: React.ReactNode[], interval?: number }) {
    const [index, setIndex] = useState(0);
    const [resetting, setResetting] = useState(false);
    const [expanded, setExpanded] = useState(false);
  
    useEffect(() => {
        if (expanded) return; // Stop animation once expanded
    
        if (index < items.length - 1) {
          const timer = setTimeout(() => {
            setIndex((prev) => prev + 1);
          }, interval);
          return () => clearTimeout(timer);
        } else {
          // Delay reset slightly to allow last word to be seen
          setTimeout(() => {
            setIndex(0);
    
            // Reset index first, then expand
            setTimeout(() => {
              setExpanded(true); // Slight delay before expanding
            }, interval); // Duration of reset transition
          }, interval);
        }
      }, [index, items.length, interval, expanded]);
  
    return (
      <div
        className={`overflow-hidden transition-max-height duration-1000 ease-in-out ${
          "home-text-height"
        }`}
      >
        <div
          className={`transition-transform duration-500 ease-in-out ${
            resetting || expanded ? "translate-y-0" : ""
          }`}
          style={{ transform: !expanded ? `translateY(-${index * 100/items.length}%)` : "none" }}
        >
          {items.map((item, i) => (
            <div key={i} className="home-text-height flex items-center justify-center">
              {item}
            </div>
          ))}
        </div>
      </div>
    );
}
