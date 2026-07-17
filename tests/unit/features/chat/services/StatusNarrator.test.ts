import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { StatusNarrationRequest } from '@/core/providers/types';
import { StatusNarrator } from '@/features/chat/services/StatusNarrator';
import type { FeatureHost } from '@/features/FeatureHost';

class FakeLine {
  className = '';
  textContent = '';
  parent: FakeContentEl | null = null;
  remove(): void {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) this.parent.children.splice(idx, 1);
      this.parent = null;
    }
  }
}

class FakeContentEl {
  children: FakeLine[] = [];
  ownerDocument = {
    createElement: () => new FakeLine(),
  };
  appendChild(child: FakeLine): FakeLine {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

interface FakeService {
  narrate: jest.Mock<Promise<string | null>, [StatusNarrationRequest]>;
  cancel: jest.Mock;
}

function createFakeService(result: string | null = 'Ich lese gerade deine Notizen'): FakeService {
  return {
    narrate: jest.fn().mockResolvedValue(result),
    cancel: jest.fn(),
  };
}

function createPlugin(enabled = true): FeatureHost {
  return {
    settings: { statusNarratorEnabled: enabled, statusNarratorModel: 'haiku' },
    providerHost: {},
  } as unknown as FeatureHost;
}

describe('StatusNarrator', () => {
  let contentEl: FakeContentEl;
  let service: FakeService;
  let registrySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    contentEl = new FakeContentEl();
    service = createFakeService();
    registrySpy = jest
      .spyOn(ProviderRegistry, 'createStatusNarrationService')
      .mockReturnValue(service);
  });

  afterEach(() => {
    registrySpy.mockRestore();
    jest.useRealTimers();
  });

  function createNarrator(plugin = createPlugin()): StatusNarrator {
    return new StatusNarrator(plugin, () => contentEl as unknown as HTMLElement);
  }

  it('stays inactive when the setting is disabled', async () => {
    const narrator = createNarrator(createPlugin(false));
    narrator.beginTurn('Moin', 'claude');
    narrator.recordToolEvent('Read _TODO.md');

    await jest.advanceTimersByTimeAsync(20_000);

    expect(registrySpy).not.toHaveBeenCalled();
    expect(service.narrate).not.toHaveBeenCalled();
    expect(contentEl.children).toHaveLength(0);
  });

  it('stays inactive when the provider has no narration service', async () => {
    registrySpy.mockReturnValue(null);
    const narrator = createNarrator();
    narrator.beginTurn('Moin', 'claude');
    narrator.recordToolEvent('Read _TODO.md');

    await jest.advanceTimersByTimeAsync(20_000);

    expect(service.narrate).not.toHaveBeenCalled();
  });

  it('renders the first narration shortly after the first tool event', async () => {
    const narrator = createNarrator();
    narrator.beginTurn('Moin, wie sieht mein Tag aus?', 'claude');
    narrator.recordToolEvent('Read _TODO.md');

    await jest.advanceTimersByTimeAsync(1_200);

    expect(service.narrate).toHaveBeenCalledTimes(1);
    expect(service.narrate).toHaveBeenCalledWith({
      userMessage: 'Moin, wie sieht mein Tag aus?',
      toolEvents: ['Read _TODO.md'],
      previousNarration: null,
    });
    expect(contentEl.children).toHaveLength(1);
    expect(contentEl.children[0].textContent).toBe('Ich lese gerade deine Notizen');
    expect(contentEl.children[0].className).toBe('claudian-narrator-line');
  });

  it('throttles subsequent narrations and passes the previous line', async () => {
    service.narrate
      .mockResolvedValueOnce('Ich lese gerade deine Notizen')
      .mockResolvedValueOnce('Jetzt prüfe ich deinen Kalender');
    const narrator = createNarrator();
    narrator.beginTurn('Moin', 'claude');
    narrator.recordToolEvent('Read _TODO.md');

    await jest.advanceTimersByTimeAsync(1_200);
    expect(service.narrate).toHaveBeenCalledTimes(1);

    narrator.recordToolEvent('get_events Kalender');
    // Still inside the throttle window — no second call yet.
    await jest.advanceTimersByTimeAsync(2_000);
    expect(service.narrate).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(8_000);
    expect(service.narrate).toHaveBeenCalledTimes(2);
    expect(service.narrate.mock.calls[1][0]).toEqual({
      userMessage: 'Moin',
      toolEvents: ['Read _TODO.md', 'get_events Kalender'],
      previousNarration: 'Ich lese gerade deine Notizen',
    });
    // The same line element is updated in place, not duplicated.
    expect(contentEl.children).toHaveLength(1);
    expect(contentEl.children[0].textContent).toBe('Jetzt prüfe ich deinen Kalender');
  });

  it('endTurn removes the line, cancels the service, and drops late results', async () => {
    let resolveNarration: (value: string | null) => void = () => undefined;
    service.narrate.mockImplementation(
      () => new Promise<string | null>((resolve) => { resolveNarration = resolve; }),
    );
    const narrator = createNarrator();
    narrator.beginTurn('Moin', 'claude');
    narrator.recordToolEvent('Read _TODO.md');
    await jest.advanceTimersByTimeAsync(1_200);
    expect(service.narrate).toHaveBeenCalledTimes(1);

    narrator.endTurn();
    expect(service.cancel).toHaveBeenCalled();

    resolveNarration('zu spät');
    await Promise.resolve();
    await Promise.resolve();

    expect(contentEl.children).toHaveLength(0);
  });

  it('ignores tool events recorded after endTurn', async () => {
    const narrator = createNarrator();
    narrator.beginTurn('Moin', 'claude');
    narrator.endTurn();
    narrator.recordToolEvent('Read _TODO.md');

    await jest.advanceTimersByTimeAsync(20_000);

    expect(service.narrate).not.toHaveBeenCalled();
  });
});
