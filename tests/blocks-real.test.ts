import { describe, expect, it } from 'vitest';
import { MempoolBlockSource } from '../src/server/blocks.js';

/**
 * Connectivity check against the real mempool.space feed. It verifies the WebSocket
 * subscription and the REST baseline, not a new block (that can take minutes).
 * Skipped when QUIZ_SKIP_NETWORK=1.
 */
describe.skipIf(process.env.QUIZ_SKIP_NETWORK === '1')('real mempool.space feed', () => {
  it('connects, receives the recent block history, reports status', async () => {
    const history: number[] = [];
    let connected = false;
    const src = new MempoolBlockSource({
      onBlock: () => {},
      onHistory: (blocks) => history.push(...blocks.map((b) => b.height)),
      onStatus: (s) => {
        if (s.connected) connected = true;
      },
    });
    src.start();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(connected && history.length > 0)) await new Promise((r) => setTimeout(r, 200));
    src.stop();
    expect(connected).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(Math.max(...history)).toBeGreaterThan(900_000);
  }, 20_000);
});
