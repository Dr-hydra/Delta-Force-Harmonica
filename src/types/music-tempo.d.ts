/**
 * music-tempo ships no types. Only the constructor surface used by
 * src/audio/beats.ts is declared here; the full parameter list is documented at
 * https://killercrush.github.io/music-tempo/docs/
 */
declare module "music-tempo" {
  interface MusicTempoParams {
    /** Minimum inter-beat interval in seconds. 0.333 caps detection at 180 BPM. */
    minBeatInterval?: number;
    /** Maximum inter-beat interval in seconds. 1 floors detection at 60 BPM. */
    maxBeatInterval?: number;
    /** Seconds an agent may go without a beat before it is discarded. */
    expiryTime?: number;
    bufferSize?: number;
    hopSize?: number;
    timeStep?: number;
  }

  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: MusicTempoParams);
    /** Estimated tempo in BPM. Formatted to three decimals, so it is a string. */
    readonly tempo: string;
    /** Beat positions in seconds. */
    readonly beats: number[];
    /** Mean inter-beat interval in seconds. */
    readonly beatInterval: number;
  }
}
