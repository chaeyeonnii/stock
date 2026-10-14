// 봇 설정: .env 값을 읽어 기본값과 합친다

export type BotConfig = {
  clientId: string;
  clientSecret: string;
  // 비워두면 계좌 목록의 첫 번째 계좌를 사용
  accountSeq: number | null;
  // true 면 주문을 실제로 보내지 않고 기록만 남긴다
  dryRun: boolean;
  pollIntervalSec: number;
  // 비워두면 보유 중인 미국 주식 전체가 대상
  symbols: string[];
  // 기준가 대비 상승률(%) — 도달 시 보유 수량의 같은 비율(%)만큼 매도
  sellLevels: number[];
  // 기준가 대비 하락률(%) — 도달 시 매수 금액의 같은 비율(%)만큼 추가 매수
  buyLevels: number[];
  // 1회 매수 주문 금액 상한 (USD)
  maxBuyUsd: number;
  dataDir: string;
};

function parseLevels(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const levels = raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0 && v < 100);
  return [...new Set(levels)].sort((a, b) => a - b);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const clientId = env.ClientId?.trim();
  const clientSecret = env.ClientSecret?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(".env 에 ClientId / ClientSecret 이 설정되어 있지 않습니다.");
  }

  const accountSeq = env.TOSS_ACCOUNT_SEQ ? Number(env.TOSS_ACCOUNT_SEQ) : null;

  return {
    clientId,
    clientSecret,
    accountSeq: Number.isInteger(accountSeq) ? accountSeq : null,
    // 실수로 실거래가 켜지지 않도록 정확히 "false" 일 때만 실주문
    dryRun: env.DRY_RUN !== "false",
    pollIntervalSec: Math.max(10, Number(env.POLL_INTERVAL_SEC) || 60),
    symbols: (env.SYMBOLS ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    sellLevels: parseLevels(env.SELL_LEVELS, [5, 10, 15]),
    buyLevels: parseLevels(env.BUY_LEVELS, [5, 10]),
    maxBuyUsd: Number(env.MAX_BUY_USD) || 500,
    dataDir: env.DATA_DIR ?? "data",
  };
}
