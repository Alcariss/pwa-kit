import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIsoDate, toIsoDate } from './dates.js';
import { escapeHtml, renderLoginScreen, setupUpdatePrompt, type RegisterSW } from './ui.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('escapeHtml', () => {
  it('escapes markup and both quote styles', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
    );
  });
});

describe('setupUpdatePrompt', () => {
  it('activates the waiting version only when the user clicks', () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    let onNeedRefresh: (() => void) | undefined;
    const registerSW: RegisterSW = (options) => {
      onNeedRefresh = options?.onNeedRefresh;
      return updateSW;
    };

    setupUpdatePrompt(registerSW, { buttonLabel: 'Update' });
    onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('.pk-update-banner button')?.click();
    expect(updateSW).toHaveBeenCalledWith(true);
  });
});

describe('renderLoginScreen', () => {
  it('renders one button per provider and reports the choice', () => {
    const onSelect = vi.fn();

    renderLoginScreen(document.body, { title: 'Notes', providers: ['google', 'github'], onSelect });
    document.querySelector<HTMLButtonElement>('.pk-login-github')?.click();

    expect(document.querySelectorAll('.pk-login-button')).toHaveLength(2);
    expect(onSelect).toHaveBeenCalledWith('github');
  });
});

describe('dates', () => {
  it('formats the local calendar day, not the UTC one', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
  });

  it('rejects dates that do not exist', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
  });
});
