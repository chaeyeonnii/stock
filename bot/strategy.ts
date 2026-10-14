// 분할 익절 / 분할 추가매수 전략
// - 기준가(처음 감지한 평균매입가) 대비 +N% 도달 → 현재 보유 수량의 N% 시장가 매도
// - 기준가 대비 -N% 도달 → 기준 매수금액의 N% 시장가 금액 매수
// - 각 단계는 한 사이클에 한 번만 실행된다

export type SymbolState = {
  basePrice: number; // 기준가 (USD)
  baseAmount: number; // 기준 매수금액 (USD)
  firedSell: number[]; // 이미 실행한 매도 단계(%)
  firedBuy: number[]; // 이미 실행한 매수 단계(%)
  startedAt: string;
};

export type Position = {
  symbol: string;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
};

export type Action =
  | { side: "SELL"; symbol: string; level: number; quantity: string; estimatedUsd: number; changePct: number }
  | { side: "BUY"; symbol: string; level: number; orderAmount: string; changePct: number }
  | { side: "SKIP"; skipped: "SELL" | "BUY"; symbol: string; level: number; reason: string; changePct: number };

export type StrategyOptions = {
  sellLevels: number[];
  buyLevels: number[];
  maxBuyUsd: number;
};

// 소수점 수량 매도는 6자리까지 지원 → 내림 처리
const floorTo = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.floor(value * f + 1e-9) / f;
};

export function initState(pos: Position, now = new Date()): SymbolState {
  return {
    basePrice: pos.averagePurchasePrice,
    baseAmount: pos.purchaseAmount,
    firedSell: [],
    firedBuy: [],
    startedAt: now.toISOString(),
  };
}

export function decide(pos: Position, state: SymbolState, opts: StrategyOptions): Action[] {
  const changePct = (pos.lastPrice / state.basePrice - 1) * 100;
  const actions: Action[] = [];

  // 매도: 낮은 단계부터 순서대로, 남은 수량 기준으로 계산
  let remaining = pos.quantity;
  for (const level of opts.sellLevels) {
    if (changePct < level || state.firedSell.includes(level)) continue;
    const qty = floorTo(remaining * (level / 100), 6);
    if (qty <= 0) {
      actions.push({ side: "SKIP", skipped: "SELL", symbol: pos.symbol, level, reason: "매도 수량이 0", changePct });
      continue;
    }
    remaining -= qty;
    actions.push({
      side: "SELL",
      symbol: pos.symbol,
      level,
      quantity: qty.toFixed(6).replace(/\.?0+$/, ""),
      estimatedUsd: floorTo(qty * pos.lastPrice, 2),
      changePct,
    });
  }

  // 매수: 기준 매수금액의 N% 만큼 금액 주문
  for (const level of opts.buyLevels) {
    if (changePct > -level || state.firedBuy.includes(level)) continue;
    const amount = floorTo(state.baseAmount * (level / 100), 2);
    if (amount > opts.maxBuyUsd) {
      actions.push({
        side: "SKIP",
        skipped: "BUY",
        symbol: pos.symbol,
        level,
        reason: `매수 금액 $${amount} 이 1회 상한 $${opts.maxBuyUsd} 초과`,
        changePct,
      });
      continue;
    }
    if (amount < 1) {
      actions.push({ side: "SKIP", skipped: "BUY", symbol: pos.symbol, level, reason: `매수 금액 $${amount} 이 너무 작음`, changePct });
      continue;
    }
    actions.push({ side: "BUY", symbol: pos.symbol, level, orderAmount: amount.toFixed(2), changePct });
  }

  return actions;
}
