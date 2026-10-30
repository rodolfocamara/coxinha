import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { SidePanel } from './SidePanel';
import { useSidePanel } from '../../lib/panels';

beforeEach(() => {
  localStorage.clear();
  act(() => {
    useSidePanel.setState({ open: true });
  });
});

describe('SidePanel', () => {
  it('renders children when the store says open', () => {
    render(
      <SidePanel>
        <div>panel-body</div>
      </SidePanel>
    );
    expect(screen.getByText('panel-body')).toBeInTheDocument();
    expect(screen.getByLabelText('Context panel')).toBeInTheDocument();
  });

  it('renders nothing when the store says closed', () => {
    act(() => {
      useSidePanel.setState({ open: false });
    });
    render(
      <SidePanel>
        <div>panel-body</div>
      </SidePanel>
    );
    expect(screen.queryByText('panel-body')).not.toBeInTheDocument();
  });

  it('persists the open state to localStorage via toggle', () => {
    act(() => {
      useSidePanel.getState().toggle();
    });
    // After one toggle from the initial `open: true`, we expect `false`.
    expect(localStorage.getItem('coxinha:side-panel')).toBe('false');
    act(() => {
      useSidePanel.getState().toggle();
    });
    expect(localStorage.getItem('coxinha:side-panel')).toBe('true');
  });
});
