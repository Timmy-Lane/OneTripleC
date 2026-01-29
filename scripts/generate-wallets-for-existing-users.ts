import { findAllUsers } from '../src/persistence/repositories/user-repository.js';
import { createWalletService } from '../src/domain/wallet/wallet-service.js';

async function main() {
  console.log('Starting wallet generation for existing users...');

  const walletService = createWalletService();
  const users = await findAllUsers();

  console.log(`Found ${users.length} users`);

  for (const user of users) {
    try {
      // Check if wallet already exists
      const existingWallet = await walletService.getWalletByUserId(user.id);
      if (existingWallet) {
        console.log(
          `✓ User ${user.id} already has wallet: ${existingWallet.address}`
        );
        continue;
      }

      // Generate wallet
      const wallet = await walletService.generateWalletForUser(user.id);
      console.log(`✓ Generated wallet for user ${user.id}: ${wallet.address}`);
    } catch (error) {
      console.error(`✗ Error processing user ${user.id}:`, error);
    }
  }

  console.log('Wallet generation completed!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
