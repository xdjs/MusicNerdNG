import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '@/components/ui/input';

describe('Input', () => {
    it('renders an input with default props', () => {
        render(<Input />);
        const input = screen.getByRole('textbox');
        expect(input).toBeInTheDocument();
        expect(input).toHaveClass(
            'flex',
            'w-full',
            'rounded-md',
            'bg-background',
            'px-3',
            'py-2',
            'text-base',
            'ring-offset-background'
        );
    });

    it('renders an input with custom className', () => {
        render(<Input className="custom-class" />);
        const input = screen.getByRole('textbox');
        expect(input).toHaveClass('custom-class');
    });

    it('renders different types correctly', () => {
        const types = ['text', 'password', 'email', 'number', 'search', 'tel', 'url'] as const;
        
        types.forEach(type => {
            render(<Input type={type} data-testid={`input-${type}`} />);
            const input = screen.getByTestId(`input-${type}`);
            expect(input).toHaveAttribute('type', type);
        });
    });

    it('handles value changes', () => {
        const handleChange = jest.fn();
        render(<Input onChange={handleChange} />);
        
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'test value' } });
        
        expect(handleChange).toHaveBeenCalledTimes(1);
        expect(input).toHaveValue('test value');
    });

    it('handles placeholder text', () => {
        render(<Input placeholder="Enter text..." />);
        const input = screen.getByPlaceholderText('Enter text...');
        expect(input).toBeInTheDocument();
    });

    it('handles disabled state', () => {
        render(<Input disabled />);
        const input = screen.getByRole('textbox');
        
        expect(input).toBeDisabled();
        expect(input).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
    });

    it('forwards ref correctly', () => {
        const ref = jest.fn();
        render(<Input ref={ref} />);
        
        expect(ref).toHaveBeenCalled();
    });

    it('handles focus and blur events', () => {
        const handleFocus = jest.fn();
        const handleBlur = jest.fn();
        
        render(<Input onFocus={handleFocus} onBlur={handleBlur} />);
        const input = screen.getByRole('textbox');
        
        fireEvent.focus(input);
        expect(handleFocus).toHaveBeenCalledTimes(1);
        
        fireEvent.blur(input);
        expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it('handles required attribute', () => {
        render(<Input required />);
        const input = screen.getByRole('textbox');
        expect(input).toBeRequired();
    });

    it('handles readonly attribute', () => {
        render(<Input readOnly />);
        const input = screen.getByRole('textbox');
        expect(input).toHaveAttribute('readonly');
    });

    it('handles maxLength attribute', () => {
        render(<Input maxLength={10} />);
        const input = screen.getByRole('textbox');
        expect(input).toHaveAttribute('maxLength', '10');
    });

    it('handles file input type', () => {
        render(<Input type="file" accept=".jpg,.png" data-testid="file-input" />);
        const input = screen.getByTestId('file-input');
        expect(input).toHaveAttribute('type', 'file');
        expect(input).toHaveAttribute('accept', '.jpg,.png');
        expect(input).toHaveClass('file:border-0', 'file:bg-transparent');
    });
}); 