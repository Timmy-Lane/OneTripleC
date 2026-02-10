# Uniswap V3 Adapter Tests

comprehensive test suite for the Uniswap V3 adapter with both automated unit tests and manual verification

## files

- `uniswap-v3-adapter.test.ts` - automated unit tests (17 tests)
- `manual-test.ts` - manual test script with visual output

## run tests

### automated unit tests
```bash
bun test src/adapters/dex/__tests__/uniswap-v3-adapter.test.ts
```

**output:**
```
✓ 17 pass
✓ 37 expect() calls
✓ ~90ms execution
```

### manual test script
```bash
bun src/adapters/dex/__tests__/manual-test.ts
```

**shows:**
- real quote fetching (USDC → WETH, USDC → DAI)
- transaction building with calldata
- path encoding verification
- slippage calculations
- error handling
- quote comparison across different amounts

## test coverage

### unit tests (mocked)

**constructor**
- initializes with config

**getQuote()**
- single-hop swap (token ↔ WETH)
- multi-hop swap (token ↔ WETH ↔ token)
- custom intermediate tokens
- null when quoter not found
- null when router not found
- null when simulation fails
- correct encoded path

**buildSwapTransaction()**
- builds valid transaction
- applies slippage correctly
- throws when path missing

**private methods**
- encodePath: single/multi-hop encoding
- derivePoolAddress: consistent addresses
- estimateFee: returns v3 fee
- applySlippage: reduces output, handles zero

### manual tests (real RPC)

**TEST 1: single-hop quote**
- quotes 1000 USDC → WETH
- shows output amount, gas, fees
- builds transaction with slippage
- validates path encoding (88 chars)

**TEST 2: multi-hop quote**
- quotes 1000 USDC → DAI (via WETH)
- shows intermediate pool details
- validates path encoding (134 chars)

**TEST 3: path encoding**
- verifies single-hop format (token + fee + token)
- verifies multi-hop format (token + fee + token + fee + token)
- validates byte lengths

**TEST 4: slippage calculation**
- tests 0%, 0.5%, 1%, 5% slippage
- validates min output calculations

**TEST 5: error handling**
- tests invalid chain rejection
- validates error messages

**TEST 6: quote comparison**
- compares quotes for 100, 1000, 10000 USDC
- shows gas estimates scale with amount

## coverage summary

| function | unit test | manual test |
|----------|-----------|-------------|
| constructor | ✓ | ✓ |
| getQuote | ✓ | ✓ |
| buildSwapTransaction | ✓ | ✓ |
| encodePath | ✓ | ✓ |
| derivePoolAddress | ✓ | - |
| estimateFee | ✓ | ✓ |
| applySlippage | ✓ | ✓ |

**total: 17 unit tests + 6 manual tests**

## example output

### unit tests
```
✓ UniswapV3Adapter > constructor > initializes with config
✓ UniswapV3Adapter > getQuote > returns quote for single-hop swap
✓ UniswapV3Adapter > getQuote > returns quote for multi-hop swap
✓ UniswapV3Adapter > buildSwapTransaction > builds valid swap transaction
...
```

### manual tests
```
TEST 1: Single-Hop Quote (USDC → WETH)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input Amount: 1000 USDC
Output Amount: 0.496439050319932657 WETH
Protocol: uniswap-v3
Gas Estimate: 96076
Path Length: 2 tokens, 1 pool
Encoded Path: 88 chars ✓
```

## notes

- unit tests use mocked RPC clients (fast, deterministic)
- manual tests use real RPC endpoints (slow, requires liquidity)
- manual tests may fail on testnets without liquidity
- both test suites cover all public + private methods
- slippage calculations verified at multiple percentages
- path encoding validated for single and multi-hop routes

## debugging

if tests fail:

1. **unit tests fail**: check mocks in test file
2. **manual tests fail**: check RPC endpoint and pool liquidity
3. **quote returns null**: normal for illiquid pools or testnets
4. **transaction build fails**: likely invalid address checksum

## adding new tests

### unit test
```typescript
test('description', async () => {
  const quote = await adapter.getQuote(params);
  expect(quote).toBeDefined();
});
```

### manual test
```typescript
async function testNewFeature() {
  section('TEST N: Feature Name');
  log('Description', value, colors.cyan);
  // test logic
}

// add to main()
await testNewFeature();
```
