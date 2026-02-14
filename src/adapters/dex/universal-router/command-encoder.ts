import { Address, Hex, concat, encodeAbiParameters, encodeFunctionData, toHex } from 'viem';
import {
   UR_COMMAND,
   FLAG_ALLOW_REVERT,
   UNIVERSAL_ROUTER_ABI,
} from './constants.js';
import type { Permit2PermitParams } from './types.js';

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

// -- permit2 encoding --

export function encodePermit2Permit(
   permit: Permit2PermitParams,
   signature: Hex
): Hex {
   // PermitSingle struct: { PermitDetails details, address spender, uint256 sigDeadline }
   // PermitDetails: { address token, uint160 amount, uint48 expiration, uint48 nonce }
   const permitSingle = {
      details: {
         token: permit.token,
         amount: permit.amount,
         expiration: permit.expiration,
         nonce: permit.nonce,
      },
      spender: permit.spender,
      sigDeadline: permit.sigDeadline,
   };

   return encodeAbiParameters(
      [
         {
            name: 'permitSingle',
            type: 'tuple',
            components: [
               {
                  name: 'details',
                  type: 'tuple',
                  components: [
                     { name: 'token', type: 'address' },
                     { name: 'amount', type: 'uint160' },
                     { name: 'expiration', type: 'uint48' },
                     { name: 'nonce', type: 'uint48' },
                  ],
               },
               { name: 'spender', type: 'address' },
               { name: 'sigDeadline', type: 'uint256' },
            ],
         },
         { name: 'signature', type: 'bytes' },
      ],
      [permitSingle, signature]
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
