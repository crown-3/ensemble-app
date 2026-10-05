import fs from 'node:fs';
import path from 'node:path';
import type { Data } from '../shared/types';

const EMPTY: Data = {
  agents: [],
  projects: [],
  chats: [],
  memories: [],
  settings: { globalInstructions: '', defaultApprovalMode: 'ask-all', theme: 'system' },
};

// All app data lives in one JSON file. Writes go to a temp file first and are
// renamed into place, so a crash mid-write never leaves a half-written file.
export class Store {
  data: Data;
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'data.json');
    this.data = fs.existsSync(this.file)
      ? { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }
      : structuredClone(EMPTY);
    for (const chat of this.data.chats) chat.projectId ??= null; // chats saved before projects existed
  }

  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
