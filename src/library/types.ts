import type { ScoreSnapshot, ScoreSnapshotInput } from "../persistence/scoreCodec";

export interface LibraryEntry {
  id: string;
  title: string;
  composer: string;
  uploader: string;
  avatar: string;
  tags: string[];
  difficulty: number;
  bpm: number;
  durationMs: number;
  noteCount: number;
  updatedAt: number;
}

export interface PublicScore extends LibraryEntry {
  snapshot: ScoreSnapshot;
}

export interface LibraryIndex {
  version: number;
  count: number;
  updatedAt: number;
  shards: Record<string, number>;
}

export interface PublishScoreArgs {
  snapshot: ScoreSnapshotInput;
  ownerToken: string;
  title: string;
  composer?: string;
  uploader: string;
  avatar?: string;
  tags?: string[];
  difficulty?: number;
}
