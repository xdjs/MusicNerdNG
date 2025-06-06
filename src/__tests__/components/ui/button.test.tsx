import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Slot } from '@radix-ui/react-slot';

// Mock Radix UI's Slot component
jest.mock('@radix-ui/react-slot', () => ({
    Slot: jest.fn(({ children, ...props }) => (
        <div data-testid="slot" {...props}>
            {children}
        </div>
    )),
}));

describe('Button', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders a button with default props', () => {
        render(<Button>Click me</Button>);
        const button = screen.getByRole('button', { name: /click me/i });
        expect(button).toBeInTheDocument();
        expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
    });

    it('renders a button with custom className', () => {
        render(<Button className="custom-class">Click me</Button>);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('custom-class');
    });

    it('renders different variants correctly', () => {
        const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
        
        variants.forEach(variant => {
            const { container } = render(<Button variant={variant} data-testid={`button-${variant}`}>Click me</Button>);
            const button = screen.getByTestId(`button-${variant}`);
            
            switch (variant) {
                case 'default':
                    expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
                    break;
                case 'destructive':
                    expect(button).toHaveClass('bg-destructive', 'text-destructive-foreground');
                    break;
                case 'outline':
                    expect(button).toHaveClass('border', 'border-input', 'bg-background');
                    break;
                case 'secondary':
                    expect(button).toHaveClass('bg-secondary', 'text-secondary-foreground');
                    break;
                case 'ghost':
                    expect(button).toHaveClass('hover:bg-accent', 'hover:text-accent-foreground');
                    break;
                case 'link':
                    expect(button).toHaveClass('text-primary', 'underline-offset-4');
                    break;
            }
        });
    });

    it('renders different sizes correctly', () => {
        const sizes = ['default', 'sm', 'lg', 'icon'] as const;
        
        sizes.forEach(size => {
            render(<Button size={size} data-testid={`button-${size}`}>Click me</Button>);
            const button = screen.getByTestId(`button-${size}`);
            
            switch (size) {
                case 'default':
                    expect(button).toHaveClass('h-10', 'px-4', 'py-2');
                    break;
                case 'sm':
                    expect(button).toHaveClass('h-9', 'rounded-md', 'px-3');
                    break;
                case 'lg':
                    expect(button).toHaveClass('h-12', 'rounded-md', 'px-8');
                    break;
                case 'icon':
                    expect(button).toHaveClass('h-10', 'w-10');
                    break;
            }
        });
    });

    it('renders as a child component when asChild is true', () => {
        render(
            <Button asChild>
                <a href="#">Link Button</a>
            </Button>
        );
        
        const slot = screen.getByTestId('slot');
        expect(slot).toBeInTheDocument();
        expect(Slot).toHaveBeenCalled();
    });

    it('handles click events', () => {
        const handleClick = jest.fn();
        render(<Button onClick={handleClick}>Click me</Button>);
        
        const button = screen.getByRole('button');
        fireEvent.click(button);
        
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('handles disabled state', () => {
        render(<Button disabled>Click me</Button>);
        const button = screen.getByRole('button');
        
        expect(button).toBeDisabled();
        expect(button).toHaveClass('disabled:pointer-events-none', 'disabled:opacity-50');
    });

    it('forwards ref correctly', () => {
        const ref = jest.fn();
        render(<Button ref={ref}>Click me</Button>);
        
        expect(ref).toHaveBeenCalled();
    });
}); 