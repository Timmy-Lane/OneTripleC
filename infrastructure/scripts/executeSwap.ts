import {
   createPublicClient,
   createWalletClient,
   getContract,
   http,
   parseEther,
} from 'viem'
import abi from '../../out/OneTripleC.sol/OneTripleC.json'
import 'dotenv/config'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.TESTNET_RPC!
const PRIVATE_KEY = process.env.PRIVATE_KEY!
const OTC = process.env.OTC

async function main(tokenIn: string, tokenOut: string) {
   const client = createPublicClient({
      chain: sepolia,
      transport: http(RPC),
   })
   const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
   const wallet = createWalletClient({
      account,
      chain: sepolia,
      transport: http(RPC),
   })

   const otc = getContract({
      address: OTC as `0x${string}`,
      abi: abi.abi,
      client: {
         public: client,
         wallet,
      },
   })

   const ISwap = {
      tokenIn,
      tokenOut,
      fee: 3000n,
      amountIn: parseEther('0.01'),
      amountOutMin: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
      sqrtPriceLimitX96: 0n,
   }

   const hash = await otc.write.swap([ISwap])
   console.log('Swap sent: ', hash)

   const receipt = await client.waitForTransactionReceipt({ hash })
   console.log('Swap executed in block: ', receipt.blockNumber)
}

const WETH = '0xdd13E55209Fd76AfE204dBda4007C227904f0a81'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

main(WETH, USDC).catch((err) => {
   console.error(err)
   process.exit(1)
})
