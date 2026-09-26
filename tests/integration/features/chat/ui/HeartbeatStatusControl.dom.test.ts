/** @jest-environment jsdom */
import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import type { HeartbeatHost, HeartbeatStatusListener, HeartbeatSummary } from '@/core/types';
import { HeartbeatStatusControl } from '@/features/chat/ui/HeartbeatStatusControl';

HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.hasClass = function (cls: string) { return this.classList.contains(cls); };
HTMLElement.prototype.toggleClass = function (cls: string | string[], value: boolean) {
  for (const name of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(name, value);
};

function summary(overrides: Partial<HeartbeatSummary> = {}): HeartbeatSummary {
  return {
    status: 'idle',
    lastRun: null,
    lastMode: 'active',
    runCount: 3,
    totalRuns: 40,
    runsToCompaction: 27,
    nextHeartbeatIn: 12,
    error: null,
    lastJournalLines: ['- Checked calendar', '- Nothing new'],
    ...overrides,
  };
}

function createHeartbeat(initial: HeartbeatSummary): HeartbeatHost & {
  emit(next: HeartbeatSummary): void;
  listenerCount(): number;
} {
  const listeners = new Set<HeartbeatStatusListener>();
  return {
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    destroy: jest.fn(),
    getSummary: jest.fn().mockResolvedValue(initial),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (next) => { for (const listener of listeners) listener(next); },
    listenerCount: () => listeners.size,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('HeartbeatStatusControl', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('opens an accessible status dropup from a native button', async () => {
    const heartbeat = createHeartbeat(summary());
    const container = document.body.createDiv();
    const control = new HeartbeatStatusControl(container, heartbeat);
    await settle();

    const button = within(document.body).getByRole('button', { name: 'Heartbeat status' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(document.body).getByText('3 / 40')).toBeTruthy();
    expect(within(document.body).getByText('12 min')).toBeTruthy();
    expect(within(document.body).getByText(/Checked calendar/)).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();

    control.handleDocumentClick(document.body);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    control.dispose();
  });

  it('reflects live status changes and stops listening once disposed', async () => {
    const heartbeat = createHeartbeat(summary());
    const control = new HeartbeatStatusControl(document.body.createDiv(), heartbeat);
    await settle();
    const button = within(document.body).getByRole('button', { name: 'Heartbeat status' });

    heartbeat.emit(summary({ status: 'running' }));
    expect(button.classList.contains('claudian-heartbeat-status--running')).toBe(true);

    heartbeat.emit(summary({ status: 'error', error: 'error_max_turns' }));
    expect(button.classList.contains('claudian-heartbeat-status--running')).toBe(false);
    expect(button.classList.contains('claudian-heartbeat-status--error')).toBe(true);

    fireEvent.click(button);
    await settle();
    expect(within(document.body).getByText('error_max_turns')).toBeTruthy();

    control.dispose();
    expect(heartbeat.listenerCount()).toBe(0);
  });
});
