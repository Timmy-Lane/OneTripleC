import {
  createUser,
  findUserByAuthProvider,
} from '../../persistence/repositories/user-repository.js';
import type { WalletService } from '../wallet/wallet-service.js';

export interface GetOrCreateUserInput {
  provider: string;
  providerId: string;
  metadata?: Record<string, unknown>;
}

export interface User {
  id: string;
  walletAddress: string;
  isNewUser: boolean;
}

export interface AuthService {
  getOrCreateUser(input: GetOrCreateUserInput): Promise<User>;
}

export function createAuthService(walletService: WalletService): AuthService {
  async function getOrCreateUser(input: GetOrCreateUserInput): Promise<User> {
    // Check if user exists
    const existingUser = await findUserByAuthProvider(
      input.provider,
      input.providerId
    );

    if (existingUser) {
      // User exists, get wallet
      const wallet = await walletService.getWalletByUserId(existingUser.id);

      if (!wallet) {
        throw new Error('User exists but has no wallet');
      }

      return {
        id: existingUser.id,
        walletAddress: wallet.address,
        isNewUser: false,
      };
    }

    // Create new user
    // For Telegram, we need to pass telegram-specific fields
    let userInput: any = {};

    if (input.provider === 'telegram') {
      userInput = {
        telegramId: parseInt(input.providerId),
        telegramUsername: input.metadata?.username as string | undefined,
        telegramFirstName: input.metadata?.first_name as string | undefined,
        authProvider: 'telegram',
        authProviderId: input.providerId,
      };
    } else {
      // For other providers, we'll need to add proper fields later
      // For now, just use dummy telegram data
      userInput = {
        telegramId: 0, // TODO: Make telegramId nullable
        telegramUsername: undefined,
        telegramFirstName: undefined,
        authProvider: input.provider,
        authProviderId: input.providerId,
      };
    }

    const user = await createUser(userInput);

    // Generate wallet
    const wallet = await walletService.generateWalletForUser(user.id);

    return {
      id: user.id,
      walletAddress: wallet.address,
      isNewUser: true,
    };
  }

  return {
    getOrCreateUser,
  };
}
