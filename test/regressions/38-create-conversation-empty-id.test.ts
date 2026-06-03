const mockVoyagerFetch = vi.fn();

vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: mockVoyagerFetch,
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  findConversationByRecipients: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

beforeEach(() => {
  mockVoyagerFetch.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ value: {} }),
  });
});

it('does not report CREATE_CONVERSATION success when LinkedIn omits the real conversation ID', async () => {
  const { createConversation } = await import('../../entrypoints/background/api/messages');

  await expect(
    createConversation(['urn:li:fsd_profile:RECIPIENT'], 'hello')
  ).rejects.toThrow(/conversation/i);
});
