# Project cleanup and reliability audit

This pass reviewed the extension's sync, offline queue, message persistence,
agent bridge, conversation UI, and tests. Existing uncommitted work was
preserved. Changes remain local for review; no release was published.

## Fixes implemented

| Area | Defect | Change and evidence |
| --- | --- | --- |
| Agent pairing | The extension accepted tool calls from its local socket before validating the pairing handshake. | Require a matching token and protocol version, then READY. Ignore obsolete sockets and withhold results after connection revocation. Bridge tests cover requests before authentication, incorrect credentials, and connection replacement. |
| Account isolation | Conversation discovery and quick polls could write old-account responses to the newly active database. Queue replay could confirm or roll back the wrong account's records. | Capture the database, check its generation across asynchronous boundaries, and carry that database through nested merges. Tests switch accounts during authentication, fetches, settings reads, queue waits, and replay responses. |
| Offline sends | A queued action whose message had already failed or changed status skipped the send but still marked the message sent and deleted saved attachments. | Only perform send bookkeeping when a send actually ran. The regression verifies no API call and preservation of the failed message and attachments. |
| Message metadata | First-load fetches, prefetches, and send responses could overwrite read receipts, reactions, and edit markers delivered during the request. Prefetch also omitted buffered receipts. | Reuse a transactional fetch-write path and preserve metadata during canonical send writes. Consume buffered receipts after commit. Tests inject metadata while API requests are in flight. |
| Invitation persistence | A repeated, unreadable, or truncated page could be treated as a complete server list, deleting locally cached invitations. Status checks and page writes also raced withdrawals. | Require evidence of a complete, fully parsed walk before pruning or recording completion. Make per-page status checks and writes atomic. Surface a failed first received-invitation page as an error. |
| Profile merging | Keeping the last duplicate profile in a page discarded fields available only in an earlier representation. | Merge complementary values within the batch and against stored profiles; remove destructive caller-side deduplication. |
| Remote search | Responses could repopulate a cleared search. Pagination from an old query could block or unlock a newer query's pagination. | Invalidate requests on clearing, account changes, and unmount; scope pagination ownership to its search generation. |
| Thread display | Live queries retained the prior recipient's messages while the next thread loaded. | Associate results with their conversation, merged IDs, and account generation before displaying them. |
| Read state | Switching to a hidden tab during the dwell timer could mark unseen messages read. | Replace three overlapping effects with one owner of the visibility listener and timer. Require two uninterrupted visible seconds. |

## Performance and simplification

- Conversation prefetch now uses indexed key lookups limited to one result,
  replacing full message counts. Keyboard and scroll prefetch share pending
  reservations and remember already cached threads. The regression records
  **two lookups across three renders and one prefetch request**, and verifies
  retry after an unsuccessful bridge response. This is a measured work-count
  reduction; browser latency was not benchmarked.
- Removed the copied queue and discovery implementations from their
  "integration" tests. The tests now import production code and use real
  IndexedDB with mocked external API boundaries. Previously, these suites
  could pass while the actual implementations were broken.
- Removed an error-handling test that never caused an error. Replaced shell
  route source-pattern assertions with execution of the shell's message and
  history behavior.
- Corrected an invitation-pruning fixture that claimed 24 server rows while
  returning only nine on its first page. Its old assertion allowed deletion
  of additional valid rows; it now verifies all 24 survivors.
- Consolidated duplicated prefetch and read-timer logic. Small wrappers that
  enforce useful boundaries, such as shared transactional message writes,
  remain intentional.

## Remaining work, in priority order

1. **Finish account isolation outside the repaired sync paths.**
   `entrypoints/background/messages.ts` and
   `entrypoints/background/sync/prefetch-posts.ts` still contain network awaits
   followed by accesses to the mutable global database. Extend captured account
   context and cancellation to these consumers and realtime work. The changes
   here do not establish an application-wide account-isolation guarantee.
2. **Reconcile uncertain send delivery before retrying.** A worker shutdown or
   account change after LinkedIn accepts a send can leave its durable action
   queued. Retrying without matching a server acknowledgement can duplicate
   delivery. This needs explicit persisted delivery state and reconciliation;
   queue serialization alone cannot guarantee exactly-once sends.
3. **Distinguish valid empty invitation responses from unrecognized payloads.**
   An empty parse with no trustworthy total can still resemble an exhausted
   list. Propagate parser authority separately from row count before allowing
   deletion, especially for authentication or page-format changes. The new
   guards cover repeated pages, observed parse loss, and count disagreement.
4. **Profile and split the startup bundle.** The production build still emits
   an app JavaScript chunk of approximately 830 kB before compression and warns
   about chunk size. Measure startup parse/evaluation and identify candidates
   for lazy loading, including optional setup/debug UI and demo/emoji data.
   This pass did not measure browser startup or change loading boundaries.
5. **Continue replacing source-pinning tests.** Regression 157 checks Tailwind
   source strings without rendering. Such assertions are brittle under safe
   refactors and can pass despite broken behavior. Keep deliberate generated
   artifact checks, but test user-visible layout and interaction where possible.
   Also remove the global `vi.waitFor` monkeypatch that forces even explicitly
   short timeouts to at least ten seconds, after addressing timing assumptions.
6. **Separate type checking from the test worker pool.** Regression 39 launches
   the TypeScript compiler as a test. Run it as an explicit package/CI check
   while preserving the release gate, rather than competing with DOM workers.
7. **Make the agent send cap atomic if it must be strict.**
   `src/lib/agent-tools/send-cap.ts` documents a read-modify-write race across
   app instances. Serialize reservations in one authority before claiming an
   enforced per-hour maximum.

## Verification

- Full Vitest suite: **257 files and 1,735 tests passed** in 55.22 seconds,
  with localhost access enabled for the MCP bridge
  integration server. The initial sandboxed run's only failing file was that
  socket integration test; its connection was rejected with EPERM.
- TypeScript no-emit check, production extension build, and whitespace/diff
  checks passed.
- Nine new message/invitation cases were observed failing before their fixes
  and passing afterwards. Additional focused tests cover the other defects.
- No live LinkedIn account actions were performed. Tests exercise mocked API
  responses, IndexedDB, DOM behavior, and local bridge connections; they do not
  validate today's undocumented LinkedIn response formats against the service.
