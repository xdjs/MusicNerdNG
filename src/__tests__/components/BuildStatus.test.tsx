// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react';
import BuildStatus from '@/app/artist/[id]/_components/onboarding/BuildStatus';

const progress = (group, text, done) => ({ kind: 'progress', group, text, done });

describe('BuildStatus', () => {
    it('shows the three build stages, not a chat', () => {
        // The flow used to be a conversation, so the surface was a chat: bubbles,
        // a typing indicator, a four-segment step rail, a tall empty column
        // waiting for replies. The build asks nothing, so none of that is true.
        render(<BuildStatus artistName="Pete Rango" items={[]} complete={false} onSkip={jest.fn()} onFinish={jest.fn()} />);
        expect(screen.getByText(/building your page/i)).toBeInTheDocument();
        expect(screen.getByText(/finding your profiles/i)).toBeInTheDocument();
        expect(screen.getByText(/wrote about you/i)).toBeInTheDocument();
        expect(screen.getByText(/writing your about/i)).toBeInTheDocument();
    });

    it('replaces a finished stage label with the count it reported', () => {
        // "Found 7 profiles" is the interesting part; the generic label is not.
        render(
            <BuildStatus
                artistName="Pete Rango"
                items={[progress('platform-search', 'Found 7 profiles', true)]}
                complete={false}
                onSkip={jest.fn()}
                onFinish={jest.fn()}
            />,
        );
        expect(screen.getByText('Found 7 profiles')).toBeInTheDocument();
        expect(screen.queryByText(/^finding your profiles$/i)).toBeNull();
    });

    it('offers no way forward until the build is done', () => {
        render(
            <BuildStatus
                artistName="Pete Rango"
                items={[progress('platform-search', 'Finding your profiles', false)]}
                complete={false}
                onSkip={jest.fn()}
                onFinish={jest.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: /see my page/i })).toBeNull();
        expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
    });

    it('hands off when complete, and stops offering Skip', () => {
        const onFinish = jest.fn();
        render(
            <BuildStatus
                artistName="Pete Rango"
                items={[
                    progress('platform-search', 'Found 7 profiles', true),
                    progress('source-search', 'Read 13 sources', true),
                    progress('about-write', 'Wrote your About', true),
                ]}
                complete
                onSkip={jest.fn()}
                onFinish={onFinish}
            />,
        );
        expect(screen.getByText(/your page is ready/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /skip for now/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /see my page/i }));
        expect(onFinish).toHaveBeenCalled();
    });

    it('leaves a stage that never reported as pending rather than breaking', () => {
        // The stage list is kept in sync with turnHandlers by hand, so a group
        // that stops being emitted must degrade quietly.
        render(
            <BuildStatus
                artistName="Pete Rango"
                items={[progress('platform-search', 'Found 7 profiles', true)]}
                complete={false}
                onSkip={jest.fn()}
                onFinish={jest.fn()}
            />,
        );
        expect(screen.getByText(/writing your about/i)).toBeInTheDocument();
    });
});
