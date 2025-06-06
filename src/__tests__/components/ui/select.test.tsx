import { render, screen, fireEvent } from '@testing-library/react';
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
    SelectValue,
} from '@/components/ui/select';

describe('Select', () => {
    it('renders select with all subcomponents', () => {
        render(
            <Select defaultValue="option1">
                <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectLabel>Fruits</SelectLabel>
                        <SelectItem value="option1">Apple</SelectItem>
                        <SelectItem value="option2">Banana</SelectItem>
                        <SelectSeparator />
                        <SelectItem value="option3">Orange</SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
        );

        // Check if trigger is rendered
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        
        // Open the select
        fireEvent.click(screen.getByRole('combobox'));
        
        // Check if content is rendered
        expect(screen.getByText('Fruits')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Orange' })).toBeInTheDocument();
    });

    it('handles selection change', () => {
        const onValueChange = jest.fn();
        render(
            <Select onValueChange={onValueChange}>
                <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="apple">Apple</SelectItem>
                    <SelectItem value="banana">Banana</SelectItem>
                </SelectContent>
            </Select>
        );

        // Open the select
        fireEvent.click(screen.getByRole('combobox'));
        
        // Select an option
        fireEvent.click(screen.getByRole('option', { name: 'Apple' }));
        
        expect(onValueChange).toHaveBeenCalledWith('apple');
    });

    it('renders disabled items correctly', () => {
        render(
            <Select>
                <SelectTrigger>
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="apple">Apple</SelectItem>
                    <SelectItem value="banana" disabled>Banana</SelectItem>
                </SelectContent>
            </Select>
        );

        // Open the select
        fireEvent.click(screen.getByRole('combobox'));
        
        const disabledOption = screen.getByRole('option', { name: 'Banana' });
        expect(disabledOption).toHaveAttribute('data-disabled');
    });

    it('handles custom trigger styling', () => {
        render(
            <Select>
                <SelectTrigger className="custom-class">
                    <SelectValue placeholder="Select an option" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="apple">Apple</SelectItem>
                </SelectContent>
            </Select>
        );

        expect(screen.getByRole('combobox')).toHaveClass('custom-class');
    });
}); 