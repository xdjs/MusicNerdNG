import React, { useState, useEffect } from 'react';

interface TypewriterProps {
    text: string;
    startDelay?: number;
    typingDelay?: number;
    className?: string;
    onComplete?: () => void;
}

const Typewriter: React.FC<TypewriterProps> = ({
    text,
    startDelay = 1000,
    typingDelay = 80,
    className = '',
    onComplete = () => { },
}) => {
    const [displayText, setDisplayText] = useState('');
    const [startTyping, setStartTyping] = useState(false);

    // Initial delay before starting
    useEffect(() => {
        const timer = setTimeout(() => {
            setStartTyping(true);
        }, startDelay);

        return () => clearTimeout(timer);
    }, [startDelay]);

    // Typing effect
    useEffect(() => {
        if (!startTyping) return;

        if (displayText.length < text.length) {
            const timer = setTimeout(() => {
                setDisplayText(text.slice(0, displayText.length + 1));
            }, typingDelay);

            return () => clearTimeout(timer);
        } else {
            onComplete();
        }
    }, [displayText, text, typingDelay, startTyping, onComplete]);

    return (
        <span>
            {displayText}
        </span>
    );
};

export default Typewriter;