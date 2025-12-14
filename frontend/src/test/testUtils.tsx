import { ReactNode } from 'react';
import { render as rtlRender, RenderOptions } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Notifications } from '@mantine/notifications';

interface WrapperProps {
  children: ReactNode;
}

// Create a wrapper with all providers
function createWrapper(initialEntries?: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: WrapperProps) {
    const Router = initialEntries ? MemoryRouter : BrowserRouter;
    const routerProps = initialEntries ? { initialEntries } : {};

    return (
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <Notifications />
          <Router {...routerProps}>{children}</Router>
        </MantineProvider>
      </QueryClientProvider>
    );
  };
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
}

// Custom render function that wraps with providers
export function renderWithProviders(
  ui: React.ReactElement,
  options: CustomRenderOptions = {}
) {
  const { initialEntries, ...renderOptions } = options;
  const Wrapper = createWrapper(initialEntries);
  return rtlRender(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything from testing-library
export * from '@testing-library/react';
export { renderWithProviders as render };

// Mock user for tests
export const mockUser = {
  id: 1,
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  phone_number: '',
  birthdate: null,
  profile_picture: null,
  bio: '',
  house: 1,
  house_name: 'House 1',
  house_inhabitant_count: 2,
  is_staff: false,
  date_joined: '2024-01-01T00:00:00Z',
};
