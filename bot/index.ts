// 자동매매 봇 실행 진입점: npm run bot

import { loadConfig } from "./config.ts";
import { Storage } from "./storage.ts";
import { decide, initState, type Action, type Position } from "./strategy.ts";
import { TossApiError, TossClient, type UsMarketDay } from "./toss-client.ts";

const config = loadConfig();
const client = new TossClient(config.clientId, config.clientSecret);
const storage = new Storage(config.dataDir, config.dryRun);
const mode = config.dryRun ? "모의" : "실거래";

const log = (msg: string) => console.log(`[${new Date().toLocaleString("ko-KR")}] [${mode}] ${msg}`);

// 장 운영 정보는 자주 바뀌지 않으므로 10분간 캐싱
let calendarCache: { day: UsMarketDay; fetchedAt: number } | null = null;

// 금액 매수·소수점 매도는 정규장 시작 ~ 정규장 종료 1시간 전까지만 접수 가능
async function isOrderWindowOpen(now = Date.now()): Promise<boolean> {
  if (!calendarCache || now - calendarCache.fetchedAt > 10 * 60 * 1000) {
    calendarCache = { day: await client.getUsMarketToday(), fetchedAt: now };
  }
  const session = calendarCache.day.regularMarket;
  if (!session) return false;
  const start = Date.parse(session.startTime);
  const end = Date.parse(session.endTime) - 60 * 60 * 1000;
  return now >= start && now < end;
}

async function resolveAccountSeq(): Promise<number> {
  if (config.accountSeq != null) return config.accountSeq;
  const accounts = await client.getAccounts();
  if (accounts.length === 0) throw new Error("조회된 계좌가 없습니다.");
  log(`계좌 ${accounts[0].accountNo} (accountSeq=${accounts[0].accountSeq}) 사용`);
  return accounts[0].accountSeq;
}

function describe(a: Action): string {
  const pct = `${a.changePct >= 0 ? "+" : ""}${a.changePct.toFixed(2)}%`;
  if (a.side === "SELL") return `${a.symbol} ${pct} → +${a.level}% 단계 매도 ${a.quantity}주 (약 $${a.estimatedUsd})`;
  if (a.side === "BUY") return `${a.symbol} ${pct} → -${a.level}% 단계 매수 $${a.orderAmount}`;
  return `${a.symbol} ${pct} → ${a.skipped === "SELL" ? "+" : "-"}${a.level}% 단계 건너뜀: ${a.reason}`;
}

async function execute(accountSeq: number, a: Action, baseKey: string) {
  if (a.side === "SKIP") {
    log(describe(a));
    storage.appendLog({ result: "skipped", ...a });
    return;
  }
  if (config.dryRun) {
    log(`[주문 안 보냄] ${describe(a)}`);
    storage.appendLog({ result: "dry-run", ...a });
    return;
  }
  // 같은 단계 주문이 중복 전송되지 않도록 멱등성 키 사용 (최대 36자)
  const clientOrderId = `${a.symbol}-${a.side}-${a.level}-${baseKey}`.replace(/[^a-zA-Z0-9\-_]/g, "_").slice(0, 36);
  try {
    const order =
      a.side === "SELL"
        ? await client.createOrder(accountSeq, { clientOrderId, symbol: a.symbol, side: "SELL", orderType: "MARKET", quantity: a.quantity })
        : await client.createOrder(accountSeq, { clientOrderId, symbol: a.symbol, side: "BUY", orderType: "MARKET", orderAmount: a.orderAmount });
    log(`주문 완료 ${describe(a)} (orderId=${order.orderId})`);
    storage.appendLog({ result: "ordered", orderId: order.orderId, clientOrderId, ...a });
  } catch (e) {
    const err = e instanceof TossApiError ? { status: e.status, code: e.code, requestId: e.requestId } : {};
    log(`주문 실패 ${describe(a)}: ${(e as Error).message}`);
    storage.appendLog({ result: "failed", error: (e as Error).message, ...err, ...a });
  }
}

async function tick(accountSeq: number) {
  if (!(await isOrderWindowOpen())) return false;

  const holdings = await client.getHoldings(accountSeq);
  const state = storage.loadState();
  const held = new Set<string>();

  for (const item of holdings) {
    if (item.marketCountry !== "US") continue;
    if (config.symbols.length > 0 && !config.symbols.includes(item.symbol)) continue;

    const pos: Position = {
      symbol: item.symbol,
      quantity: Number(item.quantity),
      lastPrice: Number(item.lastPrice),
      averagePurchasePrice: Number(item.averagePurchasePrice),
      purchaseAmount: Number(item.marketValue.purchaseAmount),
    };
    if (!(pos.quantity > 0 && pos.averagePurchasePrice > 0)) continue;
    held.add(pos.symbol);

    if (!state[pos.symbol]) {
      state[pos.symbol] = initState(pos);
      log(`${pos.symbol} 감시 시작: 기준가 $${pos.averagePurchasePrice}, 매수금액 $${pos.purchaseAmount}, 보유 ${pos.quantity}주`);
      storage.appendLog({ result: "watch-start", symbol: pos.symbol, ...state[pos.symbol] });
    }
    const s = state[pos.symbol];
    const baseKey = Date.parse(s.startedAt).toString(36);

    for (const action of decide(pos, s, config)) {
      await execute(accountSeq, action, baseKey);
      // 성공·실패·건너뜀 모두 해당 단계를 완료 처리해서 같은 주문이 반복되지 않게 한다
      const kind = action.side === "SKIP" ? action.skipped : action.side;
      (kind === "SELL" ? s.firedSell : s.firedBuy).push(action.level);
    }
  }

  // 전량 매도된 종목은 사이클을 초기화 (다시 매수하면 새 기준가로 시작)
  for (const symbol of Object.keys(state)) {
    if (!held.has(symbol) && (config.symbols.length === 0 || config.symbols.includes(symbol))) {
      log(`${symbol} 보유 없음 → 감시 종료`);
      storage.appendLog({ result: "watch-end", symbol });
      delete state[symbol];
    }
  }

  storage.saveState(state);
  return true;
}

async function main() {
  log(
    `봇 시작 — 매도 단계 +${config.sellLevels.join("/+")}%, 매수 단계 -${config.buyLevels.join("/-")}%, ` +
      `1회 매수 상한 $${config.maxBuyUsd}, ${config.pollIntervalSec}초 간격`,
  );
  if (!config.dryRun) log("⚠ 실거래 모드입니다. 실제 주문이 전송됩니다.");

  const accountSeq = await resolveAccountSeq();
  let wasOpen: boolean | null = null;

  while (true) {
    try {
      const open = await tick(accountSeq);
      if (open !== wasOpen) log(open ? "정규장 주문 가능 시간 — 감시 중" : "주문 가능 시간 아님 — 대기 중");
      wasOpen = open;
    } catch (e) {
      log(`오류: ${(e as Error).message}`);
      // 인증·IP 문제는 재시도해도 해결되지 않으므로 종료
      if (e instanceof TossApiError && [401, 403].includes(e.status)) throw e;
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalSec * 1000));
  }
}

main().catch((e) => {
  log(`봇 종료: ${(e as Error).message}`);
  process.exitCode = 1;
});
