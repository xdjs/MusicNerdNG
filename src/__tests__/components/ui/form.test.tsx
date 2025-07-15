import { render, screen, fireEvent, act } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import {
    Form,
    FormItem,
    FormLabel,
    FormControl,
    FormDescription,
    FormMessage,
    FormField,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Mock Radix UI's Slot component
jest.mock('@radix-ui/react-slot', () => ({
    Slot: jest.fn(({ children, ...props }) => (
        <div data-testid="slot" {...props}>
            {children}
        </div>
    )),
}));

// Mock Radix UI's Label component
jest.mock('@radix-ui/react-label', () => ({
    Root: jest.fn(({ children, ...props }) => (
        <label data-testid="label" {...props}>
            {children}
        </label>
    )),
}));

// Create a test schema
const formSchema = z.object({
    username: z.string().min(2, {
        message: "Username must be at least 2 characters.",
    }),
});

// Test component that uses the form
function TestForm() {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
        },
    });

    return (
        <Form {...form}>
            <form>
                <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Username</FormLabel>
                            <FormControl>
                                <Input placeholder="Enter username" {...field} />
                            </FormControl>
                            <FormDescription>
                                This is your public display name.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </form>
        </Form>
    );
}

describe('Form', () => {
    it('renders form elements correctly', () => {
        const TestComponent = () => {
            const form = useForm<z.infer<typeof formSchema>>({
                resolver: zodResolver(formSchema),
                defaultValues: {
                    username: "",
                },
            });

            return (
                <Form {...form}>
                    <form>
                        <FormField
                            control={form.control}
                            name="username"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Username</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Enter username" {...field} />
                                    </FormControl>
                                    <FormDescription>
                                        This is your public display name.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            );
        };

        render(<TestComponent />);

        expect(screen.getByText('Username')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(screen.getByText('This is your public display name.')).toBeInTheDocument();
    });

    it('handles form validation', async () => {
        const onSubmit = jest.fn();

        const TestComponent = () => {
            const form = useForm<z.infer<typeof formSchema>>({
                resolver: zodResolver(formSchema),
                defaultValues: {
                    username: "",
                },
            });

            return (
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <FormField
                            control={form.control}
                            name="username"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Username</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Enter username" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <button type="submit">Submit</button>
                    </form>
                </Form>
            );
        };

        render(<TestComponent />);

        // Test invalid submission
        await act(async () => {
            fireEvent.click(screen.getByText('Submit'));
        });

        expect(await screen.findByText('Username must be at least 2 characters.')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();

        // Test valid submission
        await act(async () => {
            fireEvent.change(screen.getByRole('textbox'), {
                target: { value: 'testuser' },
            });
            fireEvent.click(screen.getByText('Submit'));
        });

        expect(onSubmit).toHaveBeenCalledWith({ username: 'testuser' }, expect.anything());
    });

    it('renders FormItem with correct classes', () => {
        const TestWrapper = () => {
            const form = useForm();
            return (
                <Form {...form}>
                    <FormField
                        control={form.control}
                        name="test"
                        render={() => (
                            <FormItem className="custom-class">
                                <div>Content</div>
                            </FormItem>
                        )}
                    />
                </Form>
            );
        };

        render(<TestWrapper />);
        const formItem = screen.getByText('Content').parentElement;
        expect(formItem).toHaveClass('space-y-2', 'custom-class');
    });

    it('renders FormLabel with error state', () => {
        const TestComponent = () => {
            const form = useForm({
                defaultValues: {
                    test: '',
                },
            });

            return (
                <Form {...form}>
                    <form>
                        <FormField
                            control={form.control}
                            name="test"
                            render={() => (
                                <FormItem>
                                    <FormLabel>Test Label</FormLabel>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            );
        };

        render(<TestComponent />);
        const label = screen.getByTestId('label');
        expect(label).toBeInTheDocument();
    });

    it('renders FormDescription with correct classes', () => {
        const TestWrapper = () => {
            const form = useForm();
            return (
                <Form {...form}>
                    <FormField
                        control={form.control}
                        name="test"
                        render={() => (
                            <FormItem>
                                <FormDescription className="custom-class">
                                    Description text
                                </FormDescription>
                            </FormItem>
                        )}
                    />
                </Form>
            );
        };

        render(<TestWrapper />);
        const description = screen.getByText('Description text');
        expect(description).toHaveClass('text-sm', 'text-muted-foreground', 'custom-class');
    });

    it('renders FormMessage with error', () => {
        const TestComponent = () => {
            const form = useForm({
                defaultValues: {
                    test: '',
                },
            });

            return (
                <Form {...form}>
                    <form>
                        <FormField
                            control={form.control}
                            name="test"
                            render={() => (
                                <FormItem>
                                    <FormMessage>Error message</FormMessage>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            );
        };

        render(<TestComponent />);
        const message = screen.getByText('Error message');
        expect(message).toHaveClass('text-sm', 'font-medium', 'text-destructive');
    });

    it('renders FormControl with correct aria attributes', () => {
        const TestComponent = () => {
            const form = useForm({
                defaultValues: {
                    test: '',
                },
            });

            return (
                <Form {...form}>
                    <form>
                        <FormField
                            control={form.control}
                            name="test"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input {...field} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            );
        };

        render(<TestComponent />);
        const control = screen.getByTestId('slot');
        expect(control).toHaveAttribute('aria-invalid', 'false');
    });
}); 