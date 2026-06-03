// Inconsistency: suppression maps were never cleared on account switch, so one
// account's recent mutations could suppress updates for the next account.
import {
  recordMutation,
  isMutationSuppressed,
  recordMarkRead,
  shouldSuppressConversationUpdate,
  clearSuppression,
} from '../../entrypoints/background/realtime/mark-read-suppression';

it('clearSuppression clears both the mutation and mark-read windows', () => {
  recordMutation('c1');
  recordMarkRead('c2');
  expect(isMutationSuppressed('c1')).toBe(true);
  expect(shouldSuppressConversationUpdate('c2')).toBe(true);

  clearSuppression();

  expect(isMutationSuppressed('c1')).toBe(false);
  expect(shouldSuppressConversationUpdate('c2')).toBe(false);
});
