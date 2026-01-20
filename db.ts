import { PrismaClient } from "@prisma/client";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const prisma = new PrismaClient();

export async function getOrCreateUser(telegramId: number): Promise<{
    user: { telegramId: bigint; publicKey: string; privateKey: string; currentToken: string | null; currentSellToken: string | null };
    keypair: Keypair;
}> {
    let user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) }
    });

    if (!user) {
        const keypair = Keypair.generate();
        const privateKey = bs58.encode(keypair.secretKey);
        const publicKey = keypair.publicKey.toBase58();

        user = await prisma.user.create({
            data: {
                telegramId: BigInt(telegramId),
                privateKey,
                publicKey
            }
        });

        return { user, keypair };
    }

    const keypair = Keypair.fromSecretKey(bs58.decode(user.privateKey));
    return { user, keypair };
}

export async function getUserKeypair(telegramId: number): Promise<Keypair | null> {
    const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) }
    });

    if (!user) return null;
    return Keypair.fromSecretKey(bs58.decode(user.privateKey));
}

export async function updateCurrentToken(telegramId: number, tokenAddress: string): Promise<void> {
    await prisma.user.update({
        where: { telegramId: BigInt(telegramId) },
        data: { currentToken: tokenAddress }
    });
}

export async function getCurrentToken(telegramId: number): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
        select: { currentToken: true }
    });
    return user?.currentToken ?? null;
}

export async function updateCurrentSellToken(telegramId: number, tokenAddress: string): Promise<void> {
    await prisma.user.update({
        where: { telegramId: BigInt(telegramId) },
        data: { currentSellToken: tokenAddress }
    });
}

export async function getCurrentSellToken(telegramId: number): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
        select: { currentSellToken: true }
    });
    return user?.currentSellToken ?? null;
}

export { prisma };
