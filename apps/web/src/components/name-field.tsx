import {
  graphemeLength,
  limitNameToGraphemes,
  maxNameGraphemes,
} from '@machi2/shared';

export function NameField({
  autoComplete,
  autoFocus = false,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  autoComplete?: string;
  autoFocus?: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const count = graphemeLength(value);

  return (
    <div className="name-field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <output
          aria-label={`${count} of ${maxNameGraphemes} characters`}
          aria-live="polite"
          className="name-counter"
        >
          {count}/{maxNameGraphemes}
        </output>
      </div>
      <input
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        id={id}
        onChange={(event) => onChange(limitNameToGraphemes(event.target.value))}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </div>
  );
}
