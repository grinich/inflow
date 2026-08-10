// @vitest-environment jsdom
// The animated MiniChart + its icon-only type switcher (bar / column / pie).
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniChart, type ChartDatum } from '@/components/insights/MiniChart';
import { ChartSection } from '@/components/insights/ChartSection';

const data: ChartDatum[] = [
  { key: 'a', label: 'Investor', value: 8, color: '#10b981', ariaLabel: 'Show Investor', onClick: vi.fn() },
  { key: 'b', label: 'Founder', value: 5, color: '#8b5cf6', ariaLabel: 'Show Founder', onClick: vi.fn() },
];

it('renders bar rows that are clickable', () => {
  const onClick = vi.fn();
  render(<MiniChart type="bar" data={[{ key: 'a', label: 'Investor', value: 8, color: '#10b981', ariaLabel: 'Show Investor', onClick }]} />);
  fireEvent.click(screen.getByRole('button', { name: /Show Investor/i }));
  expect(onClick).toHaveBeenCalled();
});

it('animates bars in (width starts at 0)', () => {
  const { container } = render(<MiniChart type="bar" data={data} />);
  const fill = container.querySelector('[style*="width"]') as HTMLElement;
  // Before the rAF flip, the fill has not grown yet.
  expect(fill.style.width).toBe('0%');
});

it('renders a 3D pie (top + side wedge paths) in pie mode', () => {
  const { container } = render(<MiniChart type="pie" data={data} />);
  const pie = container.querySelector('[data-chart="pie"]');
  expect(pie).toBeTruthy();
  // Top faces (2 slices) plus extruded side faces → at least 2 <path> elements.
  expect(pie!.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
});

it('ChartSection switches chart type via icon buttons', () => {
  const { container } = render(<ChartSection data={data} />);
  // Defaults to bar (no pie svg).
  expect(container.querySelector('[data-chart="pie"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /pie chart/i }));
  expect(container.querySelector('[data-chart="pie"]')).toBeTruthy();
});
