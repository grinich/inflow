// @vitest-environment jsdom
// The dependency-free Markdown renderer for AI output.
import '../dom-setup';
import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/common/Markdown';

it('renders bold without leaking asterisks', () => {
  const { container } = render(<Markdown text="**Becca Gilmore** (Investor)" />);
  const strong = container.querySelector('strong');
  expect(strong?.textContent).toBe('Becca Gilmore');
  expect(container.textContent).not.toContain('**');
});

it('renders a bulleted list as <ul><li>', () => {
  const { container } = render(<Markdown text={'Investors:\n* **Ada** (GP)\n* **Alan** (Partner)'} />);
  const items = container.querySelectorAll('ul li');
  expect(items.length).toBe(2);
  expect(items[0].querySelector('strong')?.textContent).toBe('Ada');
  expect(container.textContent).not.toContain('*');
});

it('renders numbered lists as <ol><li>', () => {
  const { container } = render(<Markdown text={'1. First\n2. Second'} />);
  expect(container.querySelectorAll('ol li').length).toBe(2);
});

it('renders inline code and italics', () => {
  const { container } = render(<Markdown text={'use `npm run dev` and _stay_ sharp'} />);
  expect(container.querySelector('code')?.textContent).toBe('npm run dev');
  expect(container.querySelector('em')?.textContent).toBe('stay');
});

it('renders headings and links', () => {
  const { container } = render(<Markdown text={'### Summary\n[docs](https://example.com)'} />);
  expect(screen.getByText('Summary')).toBeInTheDocument();
  const a = container.querySelector('a');
  expect(a?.getAttribute('href')).toBe('https://example.com');
  expect(a?.getAttribute('target')).toBe('_blank');
});

it('returns nothing for empty input', () => {
  const { container } = render(<Markdown text="   " />);
  expect(container.textContent).toBe('');
});
