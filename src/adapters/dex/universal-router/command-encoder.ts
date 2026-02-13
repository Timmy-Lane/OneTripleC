import { Address, Hex, concat, encodeAbiParameters, encodeFunctionData, toHex } from 'viem';
import {
   UR_COMMAND,
   FLAG_ALLOW_REVERT,
   UNIVERSAL_ROUTER_ABI,
} from './constants.js';

// -- command byte encoding --

export function encodeCommand(
   commandId: number,
   allowRevert = false
): Hex {
   const byte = allowRevert ? commandId | FLAG_ALLOW_REVERT : commandId;
   return toHex(byte, { size: 1 });
}

export function encodeCommands(
   commands: Array<{ id: number; allowRevert?: boolean }>
): Hex {
   return concat(
      commands.map((cmd) => encodeCommand(cmd.id, cmd.allowRevert))
   );
}

// -- input encoding for each command --

export function encodeV3SwapExactIn(params: {
   recipient: Address;
   amountIn: bigint;
   amountOutMin: bigint;
   path: Hex;
   payerIsUser: boolean;
}): Hex {
   return encodeAbiParameters(
      [
         { name: 'recipient', type: 'address' },
         { name: 'amountIn', type: 'uint256' },
         { name: 'amountOutMin', type: 'uint256' },
         { name: 'path', type: 'bytes' },
         { name: 'payerIsUser', type: 'bool' },
      ],
      [
         params.recipient,
         params.amountIn,
         params.amountOutMin,
         params.path,
         params.payerIsUser,
      ]
   );
}

export function encodeV2SwapExactIn(params: {
   recipient: Address;
   amountIn: bigint;
   amountOutMin: bigint;
   path: Address[];
   payerIsUser: boolean;
}): Hex {
   return encodeAbiParameters(
      [
         { name: 'recipient', type: 'address' },
         { name: 'amountIn', type: 'uint256' },
         { name: 'amountOutMin', type: 'uint256' },
         { name: 'path', type: 'address[]' },
         { name: 'payerIsUser', type: 'bool' },
      ],
      [
         params.recipient,
         params.amountIn,
         params.amountOutMin,
         params.path,
         params.payerIsUser,
      ]
   );
}

export function encodeWrapEth(params: {
   recipient: Address;
   amount: bigint;
}): Hex {
   return encodeAbiParameters(
      [
         { name: 'recipient', type: 'address' },
         { name: 'amount', type: 'uint256' },
      ],
      [params.recipient, params.amount]
   );
}

export function encodeUnwrapWeth(params: {
   recipient: Address;
   amountMin: bigint;
}): Hex {
   return encodeAbiParameters(
      [
         { name: 'recipient', type: 'address' },
         { name: 'amountMin', type: 'uint256' },
      ],
      [params.recipient, params.amountMin]
   );
}

export function encodeSweep(params: {
   token: Address;
   recipient: Address;
   amountMin: bigint;
}): Hex {
   return encodeAbiParameters(
      [
         { name: 'token', type: 'address' },
         { name: 'recipient', type: 'address' },
         { name: 'amountMin', type: 'uint256' },
      ],
      [params.token, params.recipient, params.amountMin]
   );
}

// -- high-level: encode the full execute() calldata --

export function encodeExecute(
   commands: Hex,
   inputs: Hex[],
   deadline: bigint
): Hex {
   return encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'execute',
      args: [commands, inputs, deadline],
   });
}
