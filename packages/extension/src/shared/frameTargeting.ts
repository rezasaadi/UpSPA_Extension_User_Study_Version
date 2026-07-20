import type { ContentFillResponse } from './messages';

export type CandidateFrame = {
  frameId: number;
  parentFrameId: number;
  url: string;
};

type FrameOrderingOptions = {
  preferredFrameId?: number;
  siteId: string;
  siteIdForUrl: (url: string) => string | undefined;
};

function frameDepth(frame: CandidateFrame, byId: Map<number, CandidateFrame>): number {
  let depth = 0;
  let current = frame;
  const visited = new Set<number>();
  while (current.parentFrameId >= 0 && !visited.has(current.parentFrameId)) {
    visited.add(current.parentFrameId);
    const parent = byId.get(current.parentFrameId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function deepestFirst(frames: CandidateFrame[], byId: Map<number, CandidateFrame>): CandidateFrame[] {
  return [...frames].sort((a, b) => frameDepth(b, byId) - frameDepth(a, byId) || a.frameId - b.frameId);
}

/**
 * Orders every frame that could host this site's injected content script. A
 * known different provider is excluded; opaque/inherited and unknown frames
 * remain candidates because Chrome can inject into about:blank, data, blob,
 * srcdoc, and sandboxed descendants through origin fallback.
 */
export function orderCredentialFrameCandidates(
  frames: CandidateFrame[],
  options: FrameOrderingOptions,
): number[] {
  const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
  const siteByFrameId = new Map<number, string | undefined>();
  const sameSite: CandidateFrame[] = [];
  const inheritedOrUnknown: CandidateFrame[] = [];
  let topFrame: CandidateFrame | undefined;

  for (const frame of frames) {
    if (frame.frameId === 0) {
      topFrame = frame;
      continue;
    }
    let frameSiteId: string | undefined;
    try {
      frameSiteId = options.siteIdForUrl(frame.url);
    } catch {
      frameSiteId = undefined;
    }
    siteByFrameId.set(frame.frameId, frameSiteId);
    if (frameSiteId === options.siteId) sameSite.push(frame);
    else if (!frameSiteId) inheritedOrUnknown.push(frame);
    // A frame positively identified as another supported provider is omitted.
  }

  const ordered: number[] = [];
  const append = (frameId: number | undefined): void => {
    if (frameId === undefined || ordered.includes(frameId)) return;
    ordered.push(frameId);
  };

  const preferredFrame = options.preferredFrameId === undefined
    ? undefined
    : byId.get(options.preferredFrameId);
  if (frames.length === 0) append(options.preferredFrameId);
  else if (
    preferredFrame
    && (
      preferredFrame.frameId === 0
      || !siteByFrameId.get(preferredFrame.frameId)
      || siteByFrameId.get(preferredFrame.frameId) === options.siteId
    )
  ) {
    append(preferredFrame.frameId);
  }
  deepestFirst(sameSite, byId).forEach((frame) => append(frame.frameId));
  deepestFirst(inheritedOrUnknown, byId).forEach((frame) => append(frame.frameId));
  append(topFrame?.frameId ?? 0);
  return ordered;
}

export type SequentialFrameAttempt = {
  frameId?: number;
  response?: Extract<ContentFillResponse, { ok: true }>;
  firstFailure?: Extract<ContentFillResponse, { ok: false }>;
  attemptedFrameIds: number[];
};

/** Sends to one frame at a time and stops immediately after the first success. */
export async function tryCredentialFramesSequentially(
  frameIds: number[],
  send: (frameId: number) => Promise<ContentFillResponse | undefined>,
): Promise<SequentialFrameAttempt> {
  let firstFailure: Extract<ContentFillResponse, { ok: false }> | undefined;
  const attemptedFrameIds: number[] = [];
  for (const frameId of frameIds) {
    attemptedFrameIds.push(frameId);
    const response = await send(frameId);
    if (response?.ok) return { frameId, response, firstFailure, attemptedFrameIds };
    if (response && !response.ok) firstFailure ??= response;
  }
  return { firstFailure, attemptedFrameIds };
}
