import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// A simple component to test
function HelloWorld({ name }: { name: string }) {
  return <div>Hello, {name}!</div>;
}

describe('Example Test', () => {
  it('should render correctly', () => {
    render(
      <MantineProvider>
        <HelloWorld name="World" />
      </MantineProvider>
    );

    expect(screen.getByText('Hello, World!')).toBeInTheDocument();
  });

  it('should perform basic math', () => {
    expect(1 + 1).toBe(2);
  });
});
