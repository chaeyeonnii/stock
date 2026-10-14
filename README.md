# 미국 주식 분할 매매 봇

토스증권 Open API를 이용해 보유 중인 미국 주식을 **기준가 대비 등락률에 따라 단계적으로 분할 익절·추가 매수**하는 자동매매 프로그램입니다.

> ⚠ 토스증권 Open API에는 모의투자(sandbox) 환경이 없습니다. 실거래 모드에서는 실제 돈으로 주문이 나가므로, 반드시 모의 실행으로 기록을 충분히 확인한 뒤 전환하세요. 투자 손실에 대한 책임은 사용자에게 있습니다.

## 매매 전략

평균매입가를 **기준가**로 삼고, 각 단계에서 **한 번씩만** 시장가 주문을 냅니다.

| 조건 (기준가 대비) | 동작 |
|---|---|
| +5% / +10% / +15% | 그 시점 보유 수량의 5% / 10% / 15% 매도 |
| -5% / -10% | 기준 매수금액의 5% / 10% 추가 매수 |

- **기준가 고정**: 봇이 종목을 처음 감지했을 때의 평균매입가로 고정됩니다. 추가 매수로 평단이 바뀌어도 기준가는 그대로라서, 매수가 연쇄적으로 발생하지 않습니다.
- **여러 단계 동시 도달**: 급등으로 +12%가 되면 +5% 단계 매도 후 남은 수량의 10%를 이어서 매도합니다.
- **사이클 초기화**: 종목을 전량 매도하면 감시가 종료되고, 다시 매수하면 새 기준가로 시작합니다.
- **주문 시간**: 금액 매수·소수점 매도는 토스 정책상 **정규장 시작 ~ 종료 1시간 전**에만 접수되므로, 그 시간에만 감시합니다.
- **안전장치**: 1회 매수 금액이 상한(`MAX_BUY_USD`)을 넘으면 주문하지 않고 건너뜁니다. 같은 단계 주문은 멱등성 키(`clientOrderId`)로 중복 전송을 막습니다.

## 시작하기

### 1. API 키 발급 및 IP 등록

1. [토스증권 WTS](https://www.tossinvest.com) 로그인 → 설정 > Open API 에서 `client_id`, `client_secret` 발급
2. 같은 메뉴의 **허용 IP 관리**에 봇을 실행할 기기의 공인 IP 등록

등록되지 않은 IP에서는 모의 실행(시세·잔고 조회)도 403으로 차단됩니다.

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일을 만듭니다. (`.env`는 git에 올라가지 않습니다.)

```
ClientId=발급받은_client_id
ClientSecret=발급받은_client_secret
SYMBOLS=AAPL,TSLA
```

| 이름 | 기본값 | 설명 |
|---|---|---|
| `ClientId`, `ClientSecret` | (필수) | 토스증권 Open API 키 |
| `DRY_RUN` | `true` | 정확히 `false` 일 때만 실제 주문 전송 |
| `SYMBOLS` | 보유 미국 주식 전체 | 자동매매할 종목 티커 (쉼표 구분, 보유 중인 종목만 동작) |
| `TOSS_ACCOUNT_SEQ` | 첫 번째 계좌 | 사용할 계좌의 accountSeq |
| `SELL_LEVELS` | `5,10,15` | 매도 단계(%) |
| `BUY_LEVELS` | `5,10` | 매수 단계(%) |
| `MAX_BUY_USD` | `500` | 1회 매수 금액 상한(USD) |
| `POLL_INTERVAL_SEC` | `60` | 확인 주기(초, 최소 10) |
| `DATA_DIR` | `data` | 상태·기록 저장 폴더 |

### 3. 실행

Node.js 24 이상이 필요합니다. (TypeScript를 별도 빌드 없이 바로 실행)

```bash
npm install
npm run bot        # 봇 실행 (기본: 모의 실행)
npm run bot:test   # 전략 단위 테스트
```

## 기록 확인

| 파일 | 내용 |
|---|---|
| `data/trades.dry-run.jsonl` | 모의 실행 매매 기록 |
| `data/trades.live.jsonl` | 실거래 주문 기록 (성공·실패 포함) |
| `data/state.*.json` | 종목별 기준가와 실행된 단계 |

모의 실행과 실거래는 상태 파일이 분리되어 있어 서로 섞이지 않습니다. 사이클을 처음부터 다시 시작하려면 해당 `state` 파일을 삭제하세요.

## 실거래 전환

모의 기록이 의도대로 남는 것을 확인한 뒤 `.env` 에 다음을 추가하고 봇을 다시 실행합니다.

```
DRY_RUN=false
```

## 휴대폰에서 실행하기

- **모바일 데이터는 사용할 수 없습니다.** 공인 IP가 수시로 바뀌어 허용 IP 검사에서 차단됩니다. 집 Wi-Fi에 연결하고 그 공인 IP를 등록하세요.
- **Android (Termux)**

  ```bash
  pkg install nodejs git
  git clone https://github.com/chaeyeonnii/stock.git && cd stock
  # .env 작성 후
  npm run bot
  ```

  화면이 꺼져도 동작하도록 Termux 알림에서 **Acquire wakelock** 을 켜두세요.
- **iPhone**: 백그라운드에서 Node.js를 상시 실행할 수 없으므로 PC나 고정 IP 서버에서 실행하세요.

## 프로젝트 구조

```
bot/
├── index.ts          # 실행 루프 (장 시간 확인 → 잔고 조회 → 판단 → 주문/기록)
├── strategy.ts       # 매매 판단 로직 (순수 함수)
├── strategy.test.ts  # 전략 단위 테스트
├── toss-client.ts    # 토스증권 API 클라이언트 (토큰 캐싱, 429 재시도)
├── storage.ts        # 상태(JSON)·기록(JSONL) 저장
└── config.ts         # 환경 변수 설정
```

`src/` 에는 Next.js 앱(create-next-app 기본 구성)이 있습니다.

## 참고 문서

- [토스증권 Open API 개요](https://openapi.tossinvest.com/openapi-docs/overview.md)
- [토스증권 Open API FAQ](https://openapi.tossinvest.com/openapi-docs/faq.md)
- [OpenAPI 명세](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json)
