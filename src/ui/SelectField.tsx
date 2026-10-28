import { useId, type SelectHTMLAttributes } from 'react';
import fieldStyles from './Field.module.css';

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}

/** A labelled native <select> in the Field look. Typing the first letter or ↑/↓ changes it; Enter moves on (useEnterToNext). */
export default function SelectField({ label, options, className, ...select }: Props) {
  const id = useId();
  return (
    <div className={`${fieldStyles.field} ${className ?? ''}`.trim()}>
      <label htmlFor={id} className={fieldStyles.label}>
        {label}
      </label>
      <div className={fieldStyles.inputWrap}>
        <select {...select} id={id} className={fieldStyles.box}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
