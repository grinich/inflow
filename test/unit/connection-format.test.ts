/**
 * Tag colors: distinct role badges and stable, varied interest-tag colors.
 */
import { roleBadgeClass, interestTagClass } from '@/components/connections/connection-format';
import { ROLE_CATEGORIES } from '@/types/connection';

describe('roleBadgeClass', () => {
  it('gives every role except Other a distinct, colored badge', () => {
    const colored = ROLE_CATEGORIES.filter((r) => r !== 'Other').map(roleBadgeClass);
    // No colored role falls back to the muted neutral chip.
    expect(colored.every((c) => !c.includes('text-fg-muted'))).toBe(true);
    // Colors are distinct across roles.
    expect(new Set(colored).size).toBe(colored.length);
  });

  it('uses the muted chip for Other / unknown', () => {
    expect(roleBadgeClass('Other')).toContain('text-fg-muted');
    expect(roleBadgeClass(undefined)).toContain('text-fg-muted');
  });
});

describe('interestTagClass', () => {
  it('is stable for the same tag', () => {
    expect(interestTagClass('Investors')).toBe(interestTagClass('Investors'));
  });
  it('varies across tags', () => {
    const classes = ['Investors', 'Physician', 'CFO', 'Founder', 'Advisors'].map(interestTagClass);
    // Not all identical — different tags get different colors.
    expect(new Set(classes).size).toBeGreaterThan(1);
  });
});
