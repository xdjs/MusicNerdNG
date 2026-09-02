/** The onboarding interview: exactly three questions, all skippable (~90 seconds).
 *  Skipped questions return to the future follow-up bank (spec §6). */
export const ONBOARDING_QUESTIONS = [
    { key: "sound_in_own_words", question: "How would you describe your sound, in your own words?" },
    { key: "offline_fact", question: "What's something fans should know about you that isn't written anywhere online?" },
    { key: "working_on_now", question: "What are you working on right now?" },
] as const;

export type OnboardingQuestionKey = (typeof ONBOARDING_QUESTIONS)[number]["key"];
