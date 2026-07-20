import { describe, expect, it } from 'vitest';
import {
  orderCredentialFrameCandidates,
  tryCredentialFramesSequentially,
  type CandidateFrame,
} from './frameTargeting';

function siteIdForUrl(url: string): string | undefined {
  if (url.includes('github.com')) return 'github';
  if (url.includes('reddit.com')) return 'reddit';
  return undefined;
}

describe('credential frame targeting', () => {
  it('keeps direct and nested inherited frames and prioritizes the evidenced nested frame', () => {
    const frames: CandidateFrame[] = [
      { frameId: 0, parentFrameId: -1, url: 'https://github.com/signup' },
      { frameId: 1, parentFrameId: 0, url: 'about:blank' },
      { frameId: 2, parentFrameId: 1, url: 'about:blank' },
      { frameId: 3, parentFrameId: 0, url: 'data:text/html,credential-form' },
      { frameId: 4, parentFrameId: 0, url: 'https://www.reddit.com/login' },
    ];

    expect(orderCredentialFrameCandidates(frames, {
      preferredFrameId: 2,
      siteId: 'github',
      siteIdForUrl,
    })).toEqual([2, 1, 3, 0]);
  });

  it('tries one frame at a time and stops before sending to later frames after success', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const sent: number[] = [];
    const result = await tryCredentialFramesSequentially([2, 1, 0, 9], async (frameId) => {
      sent.push(frameId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (frameId === 2) return undefined;
      if (frameId === 1) {
        return { ok: true, filled: { username: true, passwords: 1 } };
      }
      return { ok: false, error: 'No credential fields.' };
    });

    expect(result).toMatchObject({ frameId: 1, attemptedFrameIds: [2, 1] });
    expect(sent).toEqual([2, 1]);
    expect(maxInFlight).toBe(1);
  });
});
