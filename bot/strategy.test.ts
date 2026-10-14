// 전략 단위 테스트: npm run bot:test

import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, initState, type Position } from "./strategy.ts";

const opts = { sellLevels: [5, 10, 15], buyLevels: [5, 10], maxBuyUsd: 500 };
const base: Position = { symbol: "AAPL", quantity: 10, lastPrice: 100, averagePurchasePrice: 100, purchaseAmount: 1000 };
const at = (lastPrice: number, quantity = 10): Position => ({ ...base, lastPrice, quantity });

test("기준가 근처에서는 아무것도 하지 않는다", () => {
  assert.deepEqual(decide(at(104.9), initState(base), opts), []);
  assert.deepEqual(decide(at(95.1), initState(base), opts), []);
});

test("+5% 도달 시 보유 수량의 5% 매도", () => {
  const [a] = decide(at(105), initState(base), opts);
  assert.equal(a.side, "SELL");
  assert.equal(a.side === "SELL" && a.quantity, "0.5");
});

test("이미 실행한 단계는 다시 실행하지 않는다", () => {
  const s = { ...initState(base), firedSell: [5] };
  assert.deepEqual(decide(at(106), s, opts), []);
});

test("급등으로 여러 단계를 한 번에 넘으면 남은 수량 기준으로 순서대로 매도", () => {
  const actions = decide(at(112), initState(base), opts);
  // 10주의 5% = 0.5주, 남은 9.5주의 10% = 0.95주
  assert.deepEqual(
    actions.map((a) => a.side === "SELL" && [a.level, a.quantity]),
    [
      [5, "0.5"],
      [10, "0.95"],
    ],
  );
});

test("-5% 도달 시 기준 매수금액의 5% 매수", () => {
  const [a] = decide(at(95), initState(base), opts);
  assert.equal(a.side, "BUY");
  assert.equal(a.side === "BUY" && a.orderAmount, "50.00");
});

test("-10% 도달 시 -5%, -10% 단계 모두 매수", () => {
  const actions = decide(at(89), initState(base), opts);
  assert.deepEqual(
    actions.map((a) => a.side === "BUY" && a.orderAmount),
    ["50.00", "100.00"],
  );
});

test("1회 매수 상한을 넘으면 건너뛴다", () => {
  const big = { ...base, purchaseAmount: 20000 };
  const [a] = decide({ ...big, lastPrice: 95 }, initState(big), opts);
  assert.equal(a.side, "SKIP");
  assert.equal(a.side === "SKIP" && a.skipped, "BUY");
});

test("기준가는 처음 값으로 고정된다 (추가 매수로 평단이 바뀌어도 유지)", () => {
  const s = initState(base);
  const afterBuy = { ...at(94), averagePurchasePrice: 97, purchaseAmount: 1050 };
  const actions = decide(afterBuy, { ...s, firedBuy: [5] }, opts);
  assert.deepEqual(actions, []);
});
