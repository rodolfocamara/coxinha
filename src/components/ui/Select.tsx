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
  /** Runs when the popup closes, before focus returns to the trigger; can prevent it. */
  onCloseAutoFocus?: (event: Event) => void;
};
// Prefix every value so the empty option and arbitrary IDs remain collision-free.
const encode = (value: string) => `value:${value}`;
type Option = { value: string; label: ReactNode; disabled: boolean };
type OptionProps = {
  value?: string;
  children?: ReactNode;
  disabled?: boolean;
  label?: string;
};
function options(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child)) return [];
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
/** Direct `optgroup` children keep their label; everything else is one unnamed group. */
function groups(children: ReactNode): { label?: string; options: Option[] }[] {
  const all = Children.toArray(children);
  const named = all.filter(
    (child) => isValidElement<OptionProps>(child) && child.type === 'optgroup'
  );
  if (named.length === 0) return [{ options: options(children) }];
  return (named as React.ReactElement<OptionProps>[]).map((group) => ({
    label: group.props.label,
    options: options(group.props.children),
  }));
}
function OptionItem({ option }: { option: Option }) {
  return (
    <Primitive.Item
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
  );
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
  onCloseAutoFocus,
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
            onCloseAutoFocus?.(event);
            if (!document.getElementById(id ?? '') && id) event.preventDefault();
          }}
        >
          <Primitive.ScrollUpButton className="cx-select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="cx-select-options">
            {groups(children).map((group, index) =>
              group.label ? (
                <Primitive.Group key={index}>
                  <Primitive.Label className="cx-select-group">{group.label}</Primitive.Label>
                  {group.options.map((option) => (
                    <OptionItem key={option.value} option={option} />
                  ))}
                </Primitive.Group>
              ) : (
                group.options.map((option) => <OptionItem key={option.value} option={option} />)
              )
            )}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="cx-select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
