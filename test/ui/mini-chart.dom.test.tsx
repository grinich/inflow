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

it('ChartSection defaults to pie and switches type via icon buttons', () => {
  const { container } = render(<ChartSection data={data} />);
  // Defaults to pie.
  expect(container.querySelector('[data-chart="pie"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /bar chart/i }));
  expect(container.querySelector('[data-chart="pie"]')).toBeNull();
});

describe('pie alignment across charts', () => {
  /** The flex row holding the pie and its legend. */
  const container = (n: number) => {
    const rows: ChartDatum[] = Array.from({ length: n }, (_, i) => ({
      key: `k${i}`,
      label: `Label ${i}`,
      value: n - i,
      color: '#8b5cf6',
      ariaLabel: `Show ${i}`,
    }));
    const { container: c } = render(<MiniChart type="pie" data={rows} />);
    return c.querySelector('[data-chart="pie"]')!.parentElement!;
  };

  it('pins the pie to the top rather than centring it on the legend', () => {
    // The legend's height follows its row count. Centring made a chart with
    // eight roles sit lower than one with four interest tags, so three charts
    // side by side read as misaligned.
    expect(container(8).className).toMatch(/items-start/);
    expect(container(8).className).not.toMatch(/items-center/);
  });

  it('lays out identically however many legend rows there are', () => {
    // The point is that nothing about the layout depends on the data's length.
    expect(container(8).className).toBe(container(3).className);
  });
});
