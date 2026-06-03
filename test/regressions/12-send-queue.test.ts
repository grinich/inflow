// Inconsistency/bug (Medium): send serialization lived only in the SEND_MESSAGE
// handler; the offline drainer bypassed it. This shared queue serializes both.
import { enqueueSend } from '../../entrypoints/background/send-queue';

describe('enqueueSend (per-conversation serialization)', () => {
  it('runs sends to the same conversation in order, not concurrently', async () => {
    const order: number[] = [];
    const p1 = enqueueSend('c', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const p2 = enqueueSend('c', async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('continues the chain after a failed send', async () => {
    const order: number[] = [];
    const p1 = enqueueSend('c2', async () => {
      throw new Error('boom');
    }).catch(() => {});
    const p2 = enqueueSend('c2', async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([2]);
  });

  it('runs different conversations independently', async () => {
    const a = enqueueSend('a', async () => 'a');
    const b = enqueueSend('b', async () => 'b');
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
  });
});
