# OneTripleC — DeFi Router Executor

Portfolio project demonstrating a production-style on-chain execution contract.

## What this contract does

-  Executes swaps via Uniswap v3
-  Receives all decisions off-chain
-  Supports atomic batch execution
-  Uses strict owner/executor access control

## What this contract does NOT do

-  No price discovery
-  No oracles
-  No UI
-  No aggregation logic

## Architecture

Off-chain bot prepares swap instructions →  
Executor submits tx →  
Contract validates + executes via Uniswap v3

## Tech stack

-  Solidity + OpenZeppelin
-  Foundry (tests + scripts)
-  TypeScript (off-chain execution)

## Why this project

This project is intentionally scoped as an execution-layer contract
similar to production DeFi systems (e.g. 1inch execution routers),
built for portfolio and hiring purposes.
