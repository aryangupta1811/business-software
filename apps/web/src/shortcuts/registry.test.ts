import { expect, test, vi } from 'vitest';
import { ShortcutRegistry, type Shortcut } from './registry';

function shortcut(keys: string, action = vi.fn()): Shortcut {
  return { keys, description: 'shortcuts.goHome', group: 'navigation', action };
}

/** Sends a keydown from `target` and returns whether the registry handled it. */
function press(registry: ShortcutRegistry, init: KeyboardEventInit, target?: HTMLElement) {
  let handled = false;
  const from = target ?? document.body;
  from.addEventListener(
    'keydown',
    (event) => {
      handled = registry.handle(event);
    },
    { once: true },
  );
  from.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  return handled;
}

const ALT_H = { key: 'h', code: 'KeyH', altKey: true };

test('Alt+H fires on its physical key, even on a Hindi layout', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  expect(press(registry, { key: 'ह', code: 'KeyH', altKey: true })).toBe(true);
  expect(action).toHaveBeenCalledOnce();
});

test('modifiers must match exactly: AltGr (Ctrl+Alt) is not Alt', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  expect(press(registry, { ...ALT_H, ctrlKey: true })).toBe(false);
  expect(press(registry, { key: 'h', code: 'KeyH' })).toBe(false);
  expect(action).not.toHaveBeenCalled();
});

test('? needs Shift on most layouts, and still matches', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('?', action));
  expect(press(registry, { key: '?', code: 'Slash', shiftKey: true })).toBe(true);
  expect(action).toHaveBeenCalledOnce();
});

test('? also opens on the Hindi Inscript layout, where Shift+/ types य़', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('?', action));
  expect(press(registry, { key: 'य़', code: 'Slash', shiftKey: true })).toBe(true);
  expect(action).toHaveBeenCalledOnce();
});

test('while typing, ? does not fire but F-keys, Escape and Alt+H do', () => {
  const registry = new ShortcutRegistry();
  const actions = { help: vi.fn(), f2: vi.fn(), esc: vi.fn(), home: vi.fn() };
  registry.register(shortcut('?', actions.help));
  registry.register(shortcut('F2', actions.f2));
  registry.register(shortcut('Escape', actions.esc));
  registry.register(shortcut('Alt+H', actions.home));
  const input = document.body.appendChild(document.createElement('input'));

  expect(press(registry, { key: '?', shiftKey: true }, input)).toBe(false);
  expect(press(registry, { key: 'F2' }, input)).toBe(true);
  expect(press(registry, { key: 'Escape' }, input)).toBe(true);
  expect(press(registry, ALT_H, input)).toBe(true);
  expect(actions.help).not.toHaveBeenCalled();
  input.remove();
});

test('a held key does not repeat the action', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('F2', action));
  expect(press(registry, { key: 'F2', repeat: true })).toBe(false);
  expect(action).not.toHaveBeenCalled();
});

test('keys typed while an IME is composing do not fire', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  expect(press(registry, { ...ALT_H, isComposing: true })).toBe(false);
  expect(action).not.toHaveBeenCalled();
});

test('nothing fires while paused (the help panel is open)', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  registry.setPaused(true);
  expect(press(registry, ALT_H)).toBe(false);
  registry.setPaused(false);
  expect(press(registry, ALT_H)).toBe(true);
  expect(action).toHaveBeenCalledOnce();
});

test('registering the same keys twice is an error; removing frees them', () => {
  const registry = new ShortcutRegistry();
  const remove = registry.register(shortcut('Alt+H'));
  expect(() => registry.register(shortcut('Alt+H'))).toThrow(
    'Shortcut "Alt+H" is already registered',
  );
  remove();
  expect(() => registry.register(shortcut('Alt+H'))).not.toThrow();
});

test('active() lists the current shortcuts and subscribers hear every change', () => {
  const registry = new ShortcutRegistry();
  const listener = vi.fn();
  registry.subscribe(listener);
  const home = shortcut('Alt+H');
  const remove = registry.register(home);
  expect(registry.active()).toEqual([home]);
  remove();
  expect(registry.active()).toEqual([]);
  expect(listener).toHaveBeenCalledTimes(2);
});
