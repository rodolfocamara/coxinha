import { Children, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useFieldControl } from './Field';
import './select.css';

type Props = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value' | 'multiple' | 'size'
> & {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  /** Fill the container width, as text inputs do inside a Field. */
  block?: boolean;
  size?: 'sm' | 'md';
};
// Prefix every value so the empty option and arbitrary IDs remain collision-free.
const encode = (value: string) => `value:${value}`;
function options(children: ReactNode): { value: string; label: ReactNode; disabled: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child))
      return [];
    if (child.type !== 'option') return options(child.props.children);
    return [
      {
        value: String(child.props.value ?? ''),
        label: child.props.children,
        disabled: !!child.props.disabled,
      },
    ];
  });
}
/** Theme-owned popup, with Radix keyboard, typeahead and focus management. */
export function Select({
  value,
  onChange,
  children,
  className = '',
  id,
  name,
  disabled,
  required,
  block = false,
  size = 'md',
  ...aria
}: Props) {
  const field = useFieldControl();
  id = id ?? field.id;
  required = required ?? field.required;
  return (
    <Primitive.Root
      value={encode(value)}
      onValueChange={(next) => onChange({ target: { value: next.slice(6) } })}
      disabled={disabled}
      required={required}
      name={name}
    >
      <Primitive.Trigger
        id={id}
        value={value}
        data-block={block || undefined}
        data-size={size}
        className={`cx-select ${className}`}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby'] ?? field['aria-describedby']}
        aria-invalid={aria['aria-invalid'] ?? field['aria-invalid']}
      >
        <Primitive.Value />
        <Primitive.Icon className="cx-select-chevron">
          <ChevronDown size={14} aria-hidden="true" />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          data-select-popup=""
          className="cx-select-popup"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (!document.getElementById(id ?? '') && id) event.preventDefault();
          }}
        >
          <Primitive.ScrollUpButton className="cx-select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="cx-select-options">
            {options(children).map((option) => (
              <Primitive.Item
                key={option.value}
                value={encode(option.value)}
                data-value={option.value}
                disabled={option.disabled}
                className="cx-select-option"
              >
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="cx-select-check">
                  <Check size={14} aria-hidden="true" />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="cx-select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
