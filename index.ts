import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Bot, Context, InlineKeyboard, session, type SessionFlavor } from "grammy";
import bs58 from "bs58";
import axios from "axios";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { startKeyboard, tokenBuyKeyboard, tokenSellKeyboard, walletKeyboard } from "./keyboards";
import {
    getOrCreateUser,
    getUserKeypair,
    updateCurrentToken,
    getCurrentToken,
    updateCurrentSellToken,
    getCurrentSellToken
} from "./db";

const server = Bun.serve({
    port: process.env.PORT || 3000,
    fetch(req) {
        return new Response("Bot is running!", { status: 200 });
    },
});


const rpcConnection = new Connection(process.env.ARPC_URL!);

interface SessionData {
    step: "idle" | "waiting_for_buy_amount" | "waiting_for_sell_amount";
}
type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(process.env.BOT_API_KEY!);

bot.use(session({
    initial: (): SessionData => ({ step: "idle" })
}));

async function executeJupiterSwap(ctx: any, userKeypair: Keypair, inputMint: string, outputMint: string, amountStr: string) {
    try {
        const orderResponse = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: inputMint,
                outputMint: outputMint,
                amount: amountStr,
                taker: userKeypair.publicKey.toBase58(),
                slippageBps: "100"
            },
            headers: { 'x-api-key': process.env.JUPITER_API }
        });

        const { transaction: txBase64, requestId } = orderResponse.data;
        if (!txBase64) return ctx.reply("Jupiter did not return a transaction.");
        const transactionBuffer = Buffer.from(txBase64, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);
        const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');
        const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute',
            { signedTransaction, requestId },
            { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.JUPITER_API } }
        );

        const result = executeResponse.data;
        if (result.status === "Success" || result.signature) {
            await ctx.reply(`Transaction Successful! 🚀\nTx: https://solscan.io/tx/${result.signature}`);
        } else {
            await ctx.reply('Swap submitted but status unknown.');
        }
    } catch (error: any) {
        ctx.reply("Swap failed. Ensure you have enough SOL for gas fees.");
    }
}

async function SolBuyHandler(ctx: any, amountLamports: number) {
    try {
        await ctx.answerCallbackQuery("Processing Buy...");
        if (!ctx.from?.id) return;

        const userId = ctx.from.id;
        const userKeypair = await getUserKeypair(userId);
        if (!userKeypair) return ctx.reply("Wallet not found. /start first.");

        const userBalance = await rpcConnection.getBalance(userKeypair.publicKey);
        if (userBalance <= amountLamports) return ctx.reply("Insufficient SOL balance.");

        const tokenToBuy = await getCurrentToken(userId);
        if (!tokenToBuy) return ctx.reply("No token selected.");
        await executeJupiterSwap(
            ctx,
            userKeypair,
            "So11111111111111111111111111111111111111112",
            tokenToBuy,
            amountLamports.toString()
        );
    } catch (error: any) {
        ctx.reply("Buy failed.");
    }
}

async function SellHandler(ctx: any, percentage: number) {
    try {
        await ctx.answerCallbackQuery("Processing Sell...");
        if (!ctx.from?.id) return;

        const userId = ctx.from.id;
        const userKeypair = await getUserKeypair(userId);
        const tokenMintAddress = await getCurrentSellToken(userId);

        if (!userKeypair || !tokenMintAddress) return ctx.reply("Session error. Please restart.");

        const tokenAccounts = await rpcConnection.getParsedTokenAccountsByOwner(userKeypair.publicKey, {
            mint: new PublicKey(tokenMintAddress)
        });

        if (tokenAccounts.value.length === 0) return ctx.reply("You do not hold this token.");

        // @ts-ignore
        const tokenInfo = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
        const rawBalance = BigInt(tokenInfo.amount);
        const decimals = tokenInfo.decimals;

        if (rawBalance === 0n) return ctx.reply("Balance is zero.");
        const factor = BigInt(Math.round(percentage * 100));
        const amountToSell = (rawBalance * factor) / 100n;

        await ctx.reply(`Selling ${percentage * 100}%...`);
        await executeJupiterSwap(
            ctx,
            userKeypair,
            tokenMintAddress,
            "So11111111111111111111111111111111111111112",
            amountToSell.toString()
        );

    } catch (error: any) {
        ctx.reply("Sell failed.");
    }
}

bot.command("start", async (ctx) => {
    if (!ctx.from?.id) return;
    const userId = ctx.from.id;

    const { user, keypair } = await getOrCreateUser(userId);

    await ctx.reply(
        `<b>Welcome to TradeAny_bot</b>\n\nYour Wallet Address:\n<code>${keypair.publicKey.toBase58()}</code>`,
        {
            parse_mode: "HTML",
            reply_markup: startKeyboard
        }
    );
});

bot.hears(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, async (ctx) => {
    if (!ctx.from?.id) return;
    const userId = ctx.from.id;

    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) return ctx.reply("Please /start first.");

    const tokenAddress = ctx.message!.text!;
    await updateCurrentToken(userId, tokenAddress);

    const userBalance = await rpcConnection.getBalance(userKeypair.publicKey);

    try {
        const response = await axios.get(`https://api.jup.ag/tokens/v2/search?query=${tokenAddress}`, {
            headers: { 'x-api-key': process.env.JUPITER_API }
        });

        if (response.data.length === 0) return ctx.reply("Token not found on Jupiter.");

        const tokenData = response.data[0];
        const msg = `<b>${tokenData.symbol}</b>\nPrice: $${tokenData.usdPrice}\nMCap: $${tokenData.mcap}\n\nYour Balance: ${userBalance / 1e9} SOL`;

        await ctx.reply(msg, {
            parse_mode: "HTML",
            reply_markup: tokenBuyKeyboard
        });
    } catch (e) {
        ctx.reply("Error fetching token info.");
    }
});

bot.on("message:text", async (ctx) => {
    if (!ctx.from?.id) return;
    const userId = ctx.from.id;

    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) return;

    const text = ctx.message.text.trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return;

    const amount = parseFloat(text);
    if (amount <= 0) return ctx.reply("Enter a valid amount.");

    if (ctx.session.step === "waiting_for_buy_amount") {
        const currentToken = await getCurrentToken(userId);
        if (!currentToken) return ctx.reply("No token selected.");

        const lamports = Math.round(amount * LAMPORTS_PER_SOL);
        await SolBuyHandler(ctx, lamports);
        ctx.session.step = "idle";
    }

    else if (ctx.session.step === "waiting_for_sell_amount") {
        const tokenMint = await getCurrentSellToken(userId);
        if (!tokenMint) return ctx.reply("No token selected.");

        try {
            const tokenAccounts = await rpcConnection.getParsedTokenAccountsByOwner(userKeypair.publicKey, {
                mint: new PublicKey(tokenMint)
            });

            if (tokenAccounts.value.length === 0) return ctx.reply("You do not hold this token.");

            // @ts-ignore
            const tokenInfo = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
            const decimals = tokenInfo.decimals;

            const rawAmount = BigInt(Math.round(amount * (10 ** decimals)));

            await ctx.reply(`Selling ${amount} tokens...`);

            await executeJupiterSwap(
                ctx,
                userKeypair,
                tokenMint,
                "So11111111111111111111111111111111111111112",
                rawAmount.toString()
            );
        } catch (e) {
            ctx.reply("Error processing sell amount.");
        }
        ctx.session.step = "idle";
    }
});

bot.callbackQuery("buyHandler", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`Please paste the Token Address below:`,
        { parse_mode: "Markdown" }
    );
});

bot.callbackQuery("0.1SolHandler", (ctx) => SolBuyHandler(ctx, 100000000));
bot.callbackQuery("0.5SolHandler", (ctx) => SolBuyHandler(ctx, 500000000));
bot.callbackQuery("1SolHandler", (ctx) => SolBuyHandler(ctx, 1000000000));

bot.callbackQuery("xSolHandler", async (ctx) => {
    await ctx.answerCallbackQuery("Fetching details");
    ctx.session.step = "waiting_for_buy_amount";
    await ctx.reply("Enter the amount of SOL to spend:");
});

bot.callbackQuery("sellHandler", async (ctx) => {
    if (!ctx.from?.id) return;
    await ctx.answerCallbackQuery("Fetching Wallet...");

    const userId = ctx.from.id;
    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) return ctx.reply("No wallet found.");

    const userTokenResponse = await rpcConnection.getParsedTokenAccountsByOwner(userKeypair.publicKey, {
        programId: TOKEN_PROGRAM_ID
    });

    const tokens: { mint: string, amount: number }[] = [];
    userTokenResponse.value.forEach((val) => {
        const info = val.account.data.parsed.info;
        if (info.tokenAmount.uiAmount > 0) {
            tokens.push({ mint: info.mint, amount: info.tokenAmount.uiAmount });
        }
    });

    if (tokens.length === 0) return ctx.reply("You have no tokens to sell.");

    let message = "<b>💰 Your Portfolio</b>\n\n";
    const keyboard = new InlineKeyboard();
    let btnCount = 0;
    for (let i = 0; i < tokens.length; i += 10) {
        const chunk = tokens.slice(i, i + 10);
        const mints = chunk.map(t => t.mint).join(',');

        try {
            const res = await axios.get(`https://api.dexscreener.com/tokens/v1/solana/${mints}`);
            const pairs = res.data;

            chunk.forEach(token => {
                const pair = pairs.find((p: any) => p.baseToken.address === token.mint);
                if (pair) {
                    message += `<b>${pair.baseToken.name}</b> ($${pair.baseToken.symbol})\n`;
                    message += `Balance: ${token.amount}\n`;
                    message += `Value: $${(token.amount * parseFloat(pair.priceUsd)).toFixed(2)}\n\n`;

                    keyboard.text(`Sell ${pair.baseToken.symbol}`, `sell_${token.mint}`);
                    btnCount++;
                    if (btnCount % 2 === 0) keyboard.row();
                }
            });
        } catch (e) {
            console.error("DexScreener Error");
        }
    }

    keyboard.row().text("Close", "closeHandler");

    await ctx.reply(message, { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery(/^sell_([1-9A-HJ-NP-Za-km-z]{32,44})$/, async (ctx) => {
    if (!ctx.from?.id) return;
    const userId = ctx.from.id;
    const tokenMint = ctx.match[1]!;

    await updateCurrentSellToken(userId, tokenMint);

    await ctx.answerCallbackQuery();
    await ctx.reply(
        `Selected Token Contract:\n` +
        `\`${tokenMint}\`\n\n` +
        `👇 *Select an amount to sell:*`,
        {
            parse_mode: "MarkdownV2",
            reply_markup: tokenSellKeyboard
        }
    );
});

bot.callbackQuery("25SellHandler", (ctx) => SellHandler(ctx, 0.25));
bot.callbackQuery("50SellHandler", (ctx) => SellHandler(ctx, 0.50));
bot.callbackQuery("100SellHandler", (ctx) => SellHandler(ctx, 1.0));

bot.callbackQuery("XSellHandler", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.step = "waiting_for_sell_amount";
    await ctx.reply("Enter the exact amount of tokens to sell:");
});

bot.callbackQuery("refreshHandler", async (ctx) => {
    if (!ctx.from?.id) return;
    const userId = ctx.from.id;

    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) return;

    await ctx.answerCallbackQuery("Refreshing...");
    const balance = await rpcConnection.getBalance(userKeypair.publicKey);
    await ctx.reply(`Current SOL Balance: ${balance / LAMPORTS_PER_SOL}`);
});

bot.callbackQuery("closeHandler", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.deleteMessage();
});

bot.callbackQuery("fundHandler", async (ctx) => {
    await ctx.answerCallbackQuery("Fetching details");
    if (!ctx.from.id) {
        return ctx.reply("No user detected.")
    }
    const userId = ctx.from.id;
    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) return;

    await ctx.reply("Use moonpay to fund your wallet -- https://www.moonpay.com/buy/sol ")
})

bot.callbackQuery("walletHandler", async (ctx) => {
    await ctx.answerCallbackQuery("Fetching wallet details...");
    if (!ctx.from?.id) {
        return ctx.reply("No user detected.");
    }
    const userId = ctx.from.id;
    const userKeypair = await getUserKeypair(userId);
    if (!userKeypair) {
        return ctx.reply("Do start first.");
    }
    try {
        const userBalance = await rpcConnection.getBalance(userKeypair.publicKey);
        const publicKeyStr = userKeypair.publicKey.toBase58();
        const message =
            `*TradeAni Wallet* \n\n` +
            `*Address:*\n` +
            `\`${publicKeyStr}\`\n\n` +
            `*Balance:*\n` +
            `${userBalance / 1e9} SOL`;

        try {
            await ctx.reply(message, {
                parse_mode: "MarkdownV2",
                reply_markup: walletKeyboard
            });
        } catch (e) {
            await ctx.reply("Failed to fetch wallet details. Please try again.");
        }
    } catch (error) {
        await ctx.reply("Failed to fetch wallet details. Please try again.");
    }
});

bot.callbackQuery("secretKeyHandler", async (ctx) => {
    await ctx.answerCallbackQuery("Getting your private key....")
    if (!ctx.from.id) {
        return ctx.reply("No user detected.")
    }
    const userId = ctx.from.id
    const userKeyPair = await getUserKeypair(userId)
    if (!userKeyPair) {
        return ctx.reply("Please /start first.");
    }

    const userPrivateKey = bs58.encode(userKeyPair.secretKey)
    await ctx.reply(
        `⚠️ *PRIVATE KEY REVEALED* \n\n` +
        `*Do not share this with anyone*\n\n` +
        `👇 *Tap to copy:* \n` +
        `||\`${userPrivateKey}\`||`,
        { parse_mode: "MarkdownV2" }
    );
})

bot.start();
