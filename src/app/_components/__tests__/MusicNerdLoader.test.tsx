// @ts-nocheck
import { render, screen } from '@testing-library/react';
import MusicNerdLoader from '../MusicNerdLoader';

describe('MusicNerdLoader', () => {
    it('announces itself as a status with a describable label', () => {
        render(<MusicNerdLoader label="Reading your sources" />);
        expect(screen.getByRole('status', { name: 'Reading your sources' })).toBeInTheDocument();
    });

    it('hides the mark itself from assistive tech — the status carries the meaning', () => {
        const { container } = render(<MusicNerdLoader />);
        const img = container.querySelector('img');
        expect(img).toHaveAttribute('aria-hidden', 'true');
        expect(img).toHaveAttribute('alt', '');
    });

    it('uses the square, transparent asset so it does not show a white block in dark mode', () => {
        const { container } = render(<MusicNerdLoader />);
        expect(container.querySelector('img')).toHaveAttribute('src', '/musicNerdLogo.png');
    });

    it('sizes to the requested px', () => {
        render(<MusicNerdLoader size={24} label="Working" />);
        expect(screen.getByRole('status')).toHaveStyle({ width: '24px', height: '24px' });
    });
});
