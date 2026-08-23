// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditModeContext } from '@/app/_components/EditModeContext';

const getKnowledgeDoc = jest.fn();
const correctDocClaim = jest.fn();
const undoDocCorrection = jest.fn();
jest.mock('@/app/actions/dashboardActions', () => ({
    getKnowledgeDoc: (...a) => getKnowledgeDoc(...a),
    correctDocClaim: (...a) => correctDocClaim(...a),
    undoDocCorrection: (...a) => undoDocCorrection(...a),
}));

import KnowledgeSection from '@/app/artist/[id]/_components/KnowledgeSection';

// The section renders only for an owner who is actively editing — Pete: "it
// should only appear to edit once artist hits edit." Same gate the vault uses.
const renderEditing = (props = {}) => render(
    <EditModeContext.Provider value={{ canEdit: true, isEditing: true, setIsEditing: jest.fn() }}>
        <KnowledgeSection artistId="a1" {...props} />
    </EditModeContext.Provider>,
);

const DOC = `# PETE RANGO - Artist Knowledge Document

## Career Highlights
- Won the i-Standard's Music Producers competition with Parris Pierce[1].

## Online Presence
Instagram handle @p3t3rango[2].
`;

const SOURCES = [{ id: 1, kind: 'vault', label: 'Meet Pete Rango', url: 'https://voyagemia.com/x', publishedAt: '2019-01-10' }];

describe('KnowledgeSection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getKnowledgeDoc.mockResolvedValue({ success: true, content: DOC, sources: SOURCES, corrections: [] });
        correctDocClaim.mockResolvedValue({ success: true });
        undoDocCorrection.mockResolvedValue({ success: true });
    });

    it('shows claims under a human heading, never the raw markdown header', async () => {
        // Pete: "don't want it to look like a markdown file for user."
        renderEditing();
        expect(await screen.findByText(/What you've done/i)).toBeInTheDocument();
        expect(screen.queryByText(/Career Highlights/)).toBeNull();
        expect(screen.queryByText(/^##/)).toBeNull();
        expect(screen.getByText(/i-Standard/)).toBeInTheDocument();
    });

    it('shows where a claim came from, with the year', async () => {
        // The year is usually the whole explanation for why a claim reads stale.
        renderEditing();
        expect(await screen.findByText(/voyagemia · 2019/i)).toBeInTheDocument();
    });

    it('does not repeat sections the artist already edits elsewhere', async () => {
        // Online Presence is their Links. Two places to edit one fact is two
        // places for it to disagree.
        renderEditing();
        await screen.findByText(/What you've done/i);
        expect(screen.queryByText(/p3t3rango/)).toBeNull();
    });

    it('records a claim as wrong and shows it struck through straight away', async () => {
        getKnowledgeDoc
            .mockResolvedValueOnce({ success: true, content: DOC, sources: SOURCES, corrections: [] })
            .mockResolvedValue({
                success: true, content: DOC, sources: SOURCES,
                corrections: [{ id: 'c1', claim: "Won the i-Standard's Music Producers competition with Parris Pierce.", kind: 'wrong', correction: null }],
            });
        renderEditing();
        fireEvent.click(await screen.findByTitle('Not me'));
        await waitFor(() => expect(correctDocClaim).toHaveBeenCalledWith(
            'a1', "Won the i-Standard's Music Producers competition with Parris Pierce.", 'wrong', undefined,
        ));
        expect(await screen.findByText(/you said this isn't you/i)).toBeInTheDocument();
    });

    it('will not save an empty correction', async () => {
        // An empty "fix" would silently teach the model to delete the claim.
        renderEditing();
        fireEvent.click(await screen.findByTitle('Fix this'));
        const textarea = await screen.findByPlaceholderText(/the way it actually is/i);
        fireEvent.change(textarea, { target: { value: '   ' } });
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('sends the artist wording as a fix', async () => {
        renderEditing();
        fireEvent.click(await screen.findByTitle('Fix this'));
        fireEvent.change(await screen.findByPlaceholderText(/the way it actually is/i), {
            target: { value: 'We won that in 2016, not 2019.' },
        });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        await waitFor(() => expect(correctDocClaim).toHaveBeenCalledWith(
            'a1', expect.stringContaining('i-Standard'), 'fix', 'We won that in 2016, not 2019.',
        ));
    });

    it('says so plainly when there is no document yet', async () => {
        getKnowledgeDoc.mockResolvedValue({ success: true, content: undefined, sources: [], corrections: [] });
        renderEditing();
        expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument();
    });

    it('surfaces a failure instead of pretending the correction saved', async () => {
        correctDocClaim.mockResolvedValue({ success: false, error: 'Not authorized for this artist' });
        renderEditing();
        fireEvent.click(await screen.findByTitle('Not me'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/not authorized/i);
    });

    it('renders nothing at all until the artist is editing', async () => {
        // Not public — it never was, it is owner-gated — but it should not sit
        // under their profile the rest of the time either.
        const { container } = render(
            <EditModeContext.Provider value={{ canEdit: true, isEditing: false, setIsEditing: jest.fn() }}>
                <KnowledgeSection artistId="a1" />
            </EditModeContext.Provider>,
        );
        expect(container).toBeEmptyDOMElement();
        expect(getKnowledgeDoc).not.toHaveBeenCalled();
    });

    it('renders nothing for someone who cannot edit, even in edit mode', async () => {
        const { container } = render(
            <EditModeContext.Provider value={{ canEdit: false, isEditing: true, setIsEditing: jest.fn() }}>
                <KnowledgeSection artistId="a1" />
            </EditModeContext.Provider>,
        );
        expect(container).toBeEmptyDOMElement();
        expect(getKnowledgeDoc).not.toHaveBeenCalled();
    });
});
