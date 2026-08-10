interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name for the switch. */
  label: string;
}

/**
 * A single on/off switch used across settings. Geometry is the standard
 * flex-centered track (h-6 w-11) with a 16px knob that travels translate-x-1 →
 * translate-x-6, keeping the knob fully inside the pill in both states (an
 * earlier hand-rolled absolute-positioned version let the knob overflow).
 */
export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-blue-600' : 'bg-surface-input ring-1 ring-inset ring-edge'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
