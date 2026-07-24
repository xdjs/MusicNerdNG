import { useState, useEffect } from 'react';
import { sanitizeBioText } from '@/lib/bioText';

interface BioCache {
  [artistId: string]: {
    bio: string;
    timestamp: number;
  };
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'musicnerd_bio_cache';

// Get cache from localStorage or initialize empty
const getCache = (): BioCache => {
  if (typeof window === 'undefined') return {};
  
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as BioCache;
      // Clean expired entries
      const now = Date.now();
      const cleaned = Object.fromEntries(
        Object.entries(parsed).filter(([_, value]) => 
          now - value.timestamp < CACHE_TTL
        )
      ) as BioCache;
      return cleaned;
    }
  } catch (error) {
    console.warn('Failed to load bio cache from localStorage:', error);
  }
  return {};
};

// Save cache to localStorage
const saveCache = (cache: BioCache) => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save bio cache to localStorage:', error);
  }
};

interface UseArtistBioReturn {
  bio: string | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useArtistBio(artistId: string, initialBio?: string | null): UseArtistBioReturn {
  // Check for initial value from server or cache
  const getInitialBio = (): string | undefined => {
    // Use != null to allow empty strings (only skip if undefined/null)
    // Sanitize here so stored legacy bios (markdown citations from the pre-Gemini
    // generator) never reach the page or the edit textarea.
    if (initialBio != null) return sanitizeBioText(initialBio);
    const cache = getCache();
    const cached = cache[artistId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return sanitizeBioText(cached.bio);
    }
    return undefined;
  };

  const initialValue = getInitialBio();
  const [bio, setBio] = useState<string | undefined>(initialValue);
  const [loading, setLoading] = useState(!initialValue);
  const [error, setError] = useState<string | null>(null);

  const fetchBio = async () => {
    if (!artistId) return;

    // Check cache first
    const cache = getCache();
    const cached = cache[artistId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setBio(sanitizeBioText(cached.bio));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/artistBio/${artistId}`);
      if (!response.ok) {
        throw new Error('Failed to load bio');
      }
      
      const data = await response.json();
      const bioText = sanitizeBioText(data.bio as string);
      
      // Cache the result
      const newCache = { ...cache };
      newCache[artistId] = {
        bio: bioText,
        timestamp: Date.now()
      };
      saveCache(newCache);
      
      setBio(bioText);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load bio';
      setError(errorMessage);
      setBio('Failed to load summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If the server already provided a bio, use it directly — no API call needed
    if (initialBio != null) {
      setLoading(false);
      return;
    }

    // Check cache - if valid, we already have the bio from initialization
    const cache = getCache();
    const cached = cache[artistId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setBio(sanitizeBioText(cached.bio));
      setLoading(false);
      return;
    }

    // No initialBio and no valid cache - fetch from API
    fetchBio();
  }, [artistId, initialBio]);

  const refetch = () => {
    // Clear cache and refetch
    const cache = getCache();
    delete cache[artistId];
    saveCache(cache);
    fetchBio();
  };

  return { bio, loading, error, refetch };
}
