import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from './theme';
import { useResolvedTheme } from './useTheme';

afterEach(() => {
  cleanup();
  applyTheme('light');
});

describe('resolved editor theme', () => {
  it('starts with the applied first-paint theme and follows the same HTML updates', () => {
    applyTheme('dark');
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe('dark');
    act(() => applyTheme('light'));
    expect(result.current).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe(result.current);
    act(() => applyTheme('dark'));
    expect(result.current).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe(result.current);
  });
});
