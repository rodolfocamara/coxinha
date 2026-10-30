import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useFieldControl } from './Field';
import './ui.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: 'sm' | 'md';
  ref?: React.Ref<HTMLInputElement>;
};

export function Input({ size = 'md', className = '', ...rest }: InputProps) {
  const field = useFieldControl();
  return <input data-size={size} className={`cx-input ${className}`} {...field} {...rest} />;
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: React.Ref<HTMLTextAreaElement>;
};

export function Textarea({ className = '', ...rest }: TextareaProps) {
  const field = useFieldControl();
  return <textarea className={`cx-input ${className}`} {...field} {...rest} />;
}
