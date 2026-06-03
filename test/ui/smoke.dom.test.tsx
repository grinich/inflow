// @vitest-environment jsdom
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { GroupAvatar } from '@/components/common/GroupAvatar';

function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

describe('DOM test harness smoke', () => {
  it('renders an inline component (jsdom + RTL + jest-dom matchers)', () => {
    render(<Hello name="world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders a real app component (GroupAvatar) under jsdom, with @/ alias + chrome mock', () => {
    render(<GroupAvatar names={['Alice Smith']} pictures={['']} size={40} />);
    // Single participant, no picture → initial fallback.
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
