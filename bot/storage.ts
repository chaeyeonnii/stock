// 상태 파일(JSON)과 매매 기록(JSONL) 저장

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SymbolState } from "./strategy.ts";

export type BotState = Record<string, SymbolState>;

export class Storage {
  private statePath: string;
  private logPath: string;

  // 모의 실행과 실거래는 서로 다른 파일을 사용해 상태가 섞이지 않게 한다
  constructor(dataDir: string, dryRun: boolean) {
    mkdirSync(dataDir, { recursive: true });
    const suffix = dryRun ? "dry-run" : "live";
    this.statePath = join(dataDir, `state.${suffix}.json`);
    this.logPath = join(dataDir, `trades.${suffix}.jsonl`);
  }

  loadState(): BotState {
    if (!existsSync(this.statePath)) return {};
    return JSON.parse(readFileSync(this.statePath, "utf8"));
  }

  // 임시 파일에 쓴 뒤 교체해서 중간에 꺼져도 파일이 깨지지 않게 한다
  saveState(state: BotState) {
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.statePath);
  }

  appendLog(entry: Record<string, unknown>) {
    appendFileSync(this.logPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  }
}
