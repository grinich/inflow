// @vitest-environment jsdom
// Feature: demo mode fires native Chrome notifications for simulated inbound
// messages, mirroring the real background path — created directly from the
// app page (demo mode never touches the service worker), suppressed while the
// page is visible AND focused (the in-app toast covers that case), and using
// the composited avatar icon with the plain app icon as fallback.
import '../dom-setup';
import { maybeShowDemoNotification } from '@/lib/demo-mode';
import { resetChromeMock } from '../mocks/chrome';
import { resetFetchMock } from '../mocks/fetch';

const MSG = {
  conversationId: 'demo-incoming-1',
  senderName: 'Sarah Chen',
  senderPicture: 'chrome-extension://test-extension-id/demo/w44.jpg',
  body: 'Congrats on the launch!',
};

function flush(ms = 10) {
  return new Promise((r) => setTimeout(r, ms));
}

let hasFocusSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetChromeMock();
  resetFetchMock(); // avatar fetch → 500 → icon builder falls back to app icon
  hasFocusSpy = vi.spyOn(document, 'hasFocus');
});

afterEach(() => {
  hasFocusSpy.mockRestore();
});

describe('demo mode native notifications', () => {
  it('creates a chrome notification when the app page is not focused', async () => {
    hasFocusSpy.mockReturnValue(false);

    maybeShowDemoNotification(MSG);
    await flush();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'demo-incoming-1',
      expect.objectContaining({
        type: 'basic',
        title: 'Sarah Chen',
        message: 'Congrats on the launch!',
        // Avatar fetch failed in this environment → plain app icon fallback
        iconUrl: 'chrome-extension://test-extension-id/icon-128.png',
      })
    );
  });

  it('suppresses the notification while the app page is visible and focused', async () => {
    hasFocusSpy.mockReturnValue(true); // jsdom visibilityState is 'visible'

    maybeShowDemoNotification(MSG);
    await flush();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('uses a placeholder message body when empty', async () => {
    hasFocusSpy.mockReturnValue(false);

    maybeShowDemoNotification({ ...MSG, body: '' });
    await flush();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'demo-incoming-1',
      expect.objectContaining({ message: 'New message' })
    );
  });
});
