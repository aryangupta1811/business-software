import { expect, test, vi } from 'vitest';
import { ShortcutRegistry, type Shortcut } from './registry';

function shortcut(keys: string, action = vi.fn()): Shortcut {
  return { keys, description: 'shortcuts.goHome', group: 'navigation', action };
}

/** Sends a keydown from `target`: did the registry run a shortcut, and did it keep Chrome out? */
function send(registry: ShortcutRegistry, init: KeyboardEventInit, target?: HTMLElement) {
  let handled = false;
  const from = target ?? document.body;
  from.addEventListener(
    'keydown',
    (event) => {
      handled = registry.handle(event);
    },
    { once: true },
  );
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  from.dispatchEvent(event);
  return { handled, prevented: event.defaultPrevented };
}

/** Whether the registry handled the keydown. */
function press(registry: ShortcutRegistry, init: KeyboardEventInit, target?: HTMLElement) {
  return send(registry, init, target).handled;
}

/** A modal dialog on the page, as the browser's showModal makes one. */
function openDialog() {
  const dialog = document.body.appendChild(document.createElement('dialog'));
  dialog.showModal();
  return dialog;
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

test('a held key still never reaches the browser (F3 would open find)', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('F3'));
  expect(send(registry, { key: 'F3' })).toEqual({ handled: true, prevented: true });
  expect(send(registry, { key: 'F3', repeat: true })).toEqual({ handled: false, prevented: true });
  // A key that isn't ours is left alone.
  expect(send(registry, { key: 'F4', repeat: true }).prevented).toBe(false);
});

test('a key in a text field that would just type is left alone, held or not', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('?'));
  const input = document.body.appendChild(document.createElement('input'));
  expect(send(registry, { key: '?', shiftKey: true, repeat: true }, input).prevented).toBe(false);
  input.remove();
});

test('keys typed while an IME is composing do not fire', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  expect(press(registry, { ...ALT_H, isComposing: true })).toBe(false);
  expect(action).not.toHaveBeenCalled();
});

test('a composing IME is never interrupted, not even by preventDefault', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('F3'));
  expect(send(registry, { key: 'F3', isComposing: true }).prevented).toBe(false);
});

test('an event a field already handled (defaultPrevented) is not a shortcut', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('F2', action));
  const input = document.body.appendChild(document.createElement('input'));
  input.addEventListener('keydown', (event) => {
    event.preventDefault();
  });
  expect(press(registry, { key: 'F2' }, input)).toBe(false);
  expect(action).not.toHaveBeenCalled();
  input.remove();
});

test('nothing fires while paused (the lock screen)', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  registry.register(shortcut('Alt+H', action));
  registry.setPaused(true);
  expect(press(registry, ALT_H)).toBe(false);
  registry.setPaused(false);
  expect(press(registry, ALT_H)).toBe(true);
  expect(action).toHaveBeenCalledOnce();
});

test('while paused, Chrome is still kept out of our keys, except for Esc', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('F3'));
  registry.register(shortcut('Escape'));
  registry.setPaused(true);
  expect(send(registry, { key: 'F3' })).toEqual({ handled: false, prevented: true });
  expect(send(registry, { key: 'Escape' })).toEqual({ handled: false, prevented: false });
});

test('the page shortcuts pause while any modal dialog is open, but still keep Chrome out', () => {
  const registry = new ShortcutRegistry();
  const action = vi.fn();
  const escape = vi.fn();
  registry.register(shortcut('F3', action));
  registry.register(shortcut('Escape', escape));
  const dialog = openDialog();

  expect(send(registry, { key: 'F3' })).toEqual({ handled: false, prevented: true });
  // Esc must still reach the dialog, which closes itself.
  expect(send(registry, { key: 'Escape' })).toEqual({ handled: false, prevented: false });
  expect(action).not.toHaveBeenCalled();
  expect(escape).not.toHaveBeenCalled();

  dialog.close();
  expect(press(registry, { key: 'F3' })).toBe(true);
  expect(action).toHaveBeenCalledOnce();
  dialog.remove();
});

test('a dialog’s own shortcuts work only while a dialog is open', () => {
  const registry = new ShortcutRegistry();
  const page = vi.fn();
  const own = vi.fn();
  registry.register(shortcut('F10', page));
  registry.register({ ...shortcut('F10', own), inDialog: true });

  expect(press(registry, { key: 'F10' })).toBe(true);
  expect(page).toHaveBeenCalledOnce();
  expect(own).not.toHaveBeenCalled();

  const dialog = openDialog();
  expect(press(registry, { key: 'F10' })).toBe(true);
  expect(page).toHaveBeenCalledOnce();
  expect(own).toHaveBeenCalledOnce();
  dialog.remove();
});

test('a dialog may take Escape for itself, and a held key still does not repeat', () => {
  const registry = new ShortcutRegistry();
  const close = vi.fn();
  registry.register({ ...shortcut('Escape', close), inDialog: true });
  const dialog = openDialog();
  expect(send(registry, { key: 'Escape' })).toEqual({ handled: true, prevented: true });
  expect(press(registry, { key: 'Escape', repeat: true })).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  dialog.remove();
});

test('a dialog’s shortcuts stay out of the list of page shortcuts', () => {
  const registry = new ShortcutRegistry();
  const page = shortcut('F3');
  registry.register(page);
  registry.register({ ...shortcut('F10'), inDialog: true });
  expect(registry.active()).toEqual([page]);
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

test('the page and a dialog may use the same keys, but not twice in one place', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('F10'));
  expect(() => registry.register({ ...shortcut('F10'), inDialog: true })).not.toThrow();
  expect(() => registry.register({ ...shortcut('F10'), inDialog: true })).toThrow(/already/);
});

test('in production a clash warns and keeps the first shortcut', () => {
  const registry = new ShortcutRegistry({ throwOnClash: false });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const first = vi.fn();
  const second = vi.fn();
  registry.register(shortcut('Alt+H', first));
  const removeSecond = registry.register(shortcut('Alt+H', second));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('Alt+H'));
  expect(registry.active()).toHaveLength(1);
  press(registry, ALT_H);
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  // Removing the refused one must not remove the first.
  removeSecond();
  expect(registry.active()).toHaveLength(1);
});

test('the browser’s reserved keys are never handled or taken', () => {
  const registry = new ShortcutRegistry();
  registry.register(shortcut('F2'));
  expect(send(registry, { key: 'F5' })).toEqual({ handled: false, prevented: false });
  expect(send(registry, { key: 'F12', ctrlKey: true, shiftKey: true }).prevented).toBe(false);
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
