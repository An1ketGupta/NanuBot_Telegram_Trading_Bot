import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { Bot, Context, session, type SessionFlavor } from "grammy";
import { startKeyboard, tokenBuyKeyboard, zeroBalanceKeyboard } from "./keyboards";
import axios from "axios";

const userSecretKey = new Uint8Array([66, 57, 79, 71, 158, 217, 65, 3, 71, 69, 156, 36, 217, 76, 24, 7, 126, 247, 20, 36, 115, 166, 236, 79, 238, 127, 119, 182, 27, 39, 196, 37, 73, 12, 163, 23, 156, 234, 219, 125, 32, 167, 40, 162, 186, 5, 125, 166, 198, 117, 213, 158, 106, 79, 74, 72, 137, 90, 37, 74, 214, 16, 180, 10])
const mainKeypair = Keypair.fromSecretKey(userSecretKey);

const KeyPairData: Record<number, Keypair> = { 6296735010: mainKeypair };

const connection = new Connection(process.env.RPC_URL!)
const rpcConnection = new Connection(process.env.ARPC_URL!)

const tokenAPI = process.env.BOT_API_KEY;
if (!tokenAPI) {
    throw new Error("Token API must be included.")
}

interface SessionData {
    step: "idle" | "waiting_for_amount"
}
type myContext = Context & SessionFlavor<SessionData>

let currentToken: string = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const bot = new Bot<myContext>(process.env.BOT_API_KEY!)
bot.use(session({
    initial: (): SessionData => ({ step: "idle" })
}));

bot.command("start", async (ctx) => {
    if (!ctx.from?.id) {
        throw new Error("No userid detected")
    }
    const userId: number = ctx.from?.id;
    if (!KeyPairData[userId]) {
        KeyPairData[userId] = Keypair.generate();
    }
    const userKeyPair = KeyPairData[userId];

    await ctx.reply(`<b>Welcome to NanuBot</b><b>This is your Public Key (Wallet Address): <i>${userKeyPair.publicKey.toBase58()}</i></b>`,
        {
            parse_mode: "HTML",
            reply_markup: startKeyboard
        }
    )
})

bot.hears(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, async (ctx) => {
    if (!ctx.from?.id) {
        throw new Error("Invalid token address.")
    }
    const userId = ctx.from.id;
    const userPublicKey = KeyPairData[userId]?.publicKey
    if (!userPublicKey) {
        throw new Error("No PublicKey")
    }

    currentToken = ctx.message?.text!
    const userBalance = await connection.getBalance(userPublicKey)
    if (userBalance == 0) {
        await ctx.reply("You have 0 sol in your wallet.", {
            reply_markup: zeroBalanceKeyboard
        })
    }
    else {
        const response = await axios.get('https://api.jup.ag/tokens/v2/search?query=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', {
            headers: {
                'x-api-key': process.env.JUPITER_API!
            }
        })
        const tokenName = response.data[0].symbol
        const tokenPrice = response.data[0].usdPrice
        const marketCap = response.data[0].mcap
        await ctx.reply(`Token Name- ${tokenName}\n` + `Token Price- ${tokenPrice}\n` + `Market Cap- ${marketCap}\n` + `Your Balance- ${userBalance / 1e9} sol`, {
            reply_markup: tokenBuyKeyboard
        })
    }
})

bot.callbackQuery("buyHandler", async (ctx) => {
    if (!ctx.from?.id) {
        throw new Error("htt")
    }

    const userId = ctx.from.id;
    const userPublicKey = KeyPairData[userId]?.publicKey
    if (!userPublicKey) {
        throw new Error("No PublicKey")
    }
    await ctx.answerCallbackQuery("Fetching your account details....")
    const userBalance = await connection.getBalance(userPublicKey)
    if (userBalance == 0) {
        await ctx.reply("You have 0 sol in your wallet.", {
            reply_markup: zeroBalanceKeyboard
        })
    }
    else {
        await ctx.reply(`Your balance- ${userBalance}\n` + `Enter the token address you want to buy:`)
    }
})

bot.callbackQuery("0.1SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) {
            return ctx.reply("User not detected.");
        }
        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];
        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const userBalance = await rpcConnection.getBalance(userPublicKey);
        const amountToSwap = 100000000;
        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const response = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentToken,
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58()
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const data = response.data;
        if (!data.transaction) {
            throw new Error("No transaction returned from Jupiter API");
        }
        const transactionBuffer = Buffer.from(data.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);
        const rawTransaction = transaction.serialize();

        const txnSignature = await rpcConnection.sendRawTransaction(rawTransaction);
        ctx.reply(`Transaction sent! Waiting for confirmation... \n`);
        const latestBlockhash = await rpcConnection.getLatestBlockhash();

        const confirmation = await rpcConnection.confirmTransaction({
            signature: txnSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        });

        if (confirmation.value.err) {
            return ctx.reply(`Transaction failed.`);
        } else {
            return ctx.reply("Swap successful!");
        }

    }
    catch (error: any) {
        return ctx.reply(`An error occurred.`);
    }
});

bot.callbackQuery("0.5SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) {
            return ctx.reply("User not detected.");
        }
        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];
        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const userBalance = await rpcConnection.getBalance(userPublicKey);
        const amountToSwap = 500000000;
        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const response = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentToken,
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58()
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const data = response.data;
        if (!data.transaction) {
            throw new Error("No transaction returned from Jupiter API");
        }
        const transactionBuffer = Buffer.from(data.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);
        const rawTransaction = transaction.serialize();
        const txnSignature = await rpcConnection.sendRawTransaction(rawTransaction);
        ctx.reply(`Transaction sent! Waiting for confirmation... \n`);
        const latestBlockhash = await rpcConnection.getLatestBlockhash();

        const confirmation = await rpcConnection.confirmTransaction({
            signature: txnSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        });

        if (confirmation.value.err) {
            return ctx.reply(`Transaction failed.`);
        } else {
            return ctx.reply("Swap successful!");
        }

    }
    catch (error: any) {
        return ctx.reply(`An error occurred.`);
    }
});

bot.callbackQuery("1SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) {
            return ctx.reply("User not detected.");
        }
        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];
        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const userBalance = await rpcConnection.getBalance(userPublicKey);
        const amountToSwap = 1000000000;
        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const response = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentToken,
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58()
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const data = response.data;
        if (!data.transaction) {
            throw new Error("No transaction returned from Jupiter API");
        }
        const transactionBuffer = Buffer.from(data.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);
        const rawTransaction = transaction.serialize();

        const txnSignature = await rpcConnection.sendRawTransaction(rawTransaction);
        ctx.reply(`Transaction sent! Waiting for confirmation... \n`);
        const latestBlockhash = await rpcConnection.getLatestBlockhash();

        const confirmation = await rpcConnection.confirmTransaction({
            signature: txnSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        });

        if (confirmation.value.err) {
            return ctx.reply(`Transaction failed.`);
        } else {
            return ctx.reply("Swap successful!");
        }

    }
    catch (error: any) {
        return ctx.reply(`An error occurred.`);
    }
});

bot.callbackQuery("xSolHandler", async (ctx) => {
    if (!ctx.from.id) {
        await ctx.reply("No user detected.")
    }

    const userId = ctx.from.id;
    if (!KeyPairData[userId]) {
        await ctx.reply("You do not have a account. Do /start first")
    }
    await ctx.answerCallbackQuery("Fetching details")
    ctx.session.step = "waiting_for_amount"
    await ctx.reply("Enter the amount of Sol you want to buy for -- ")
})

bot.on("message:text", async (ctx) => {
    if (!ctx.from.id) {
        await ctx.reply("No user detected.")
    }

    const userId = ctx.from.id;
    if (!KeyPairData[userId]) {
        await ctx.reply("You do not have a account. Do /start first")
    }

    if (ctx.session.step == "waiting_for_amount") {
        const stringAmount = ctx.message.text.trim()
        const isValidNumber = /^\d+(\.\d+)?$/.test(stringAmount);
        const amount = parseFloat(stringAmount);
        if (!isValidNumber || amount < 0) {
            return ctx.reply("Enter a valid amount.")
        }
        else {
            const amountToSwap = Math.round(amount * LAMPORTS_PER_SOL);
            const userKeypair = KeyPairData[userId]!;
            const userPublicKey = userKeypair.publicKey;
            const userBalance = await rpcConnection.getBalance(userPublicKey);
            if (userBalance <= amountToSwap) {
                return ctx.reply("Insufficient balance.");
            }
            const response = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
                params: {
                    inputMint: "So11111111111111111111111111111111111111112",
                    outputMint: currentToken,
                    amount: amountToSwap.toString(),
                    taker: userPublicKey.toBase58()
                },
                headers: {
                    'x-api-key': process.env.JUPITER_API
                }
            });

            const data = response.data;
            if (!data.transaction) {
                throw new Error("No transaction returned from Jupiter API");
            }
            const transactionBuffer = Buffer.from(data.transaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            transaction.sign([userKeypair]);
            const rawTransaction = transaction.serialize();
            const sendTransaction = Buffer.from(rawTransaction).toBase64();

            const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': 'JUPITER_API',
                },
                body: JSON.stringify({
                    signedTransaction: sendTransaction,
                    // @ts-ignore
                    requestId: response.requestId,
                }),
            })

            // @ts-ignore
            const jsonResponse = await executeResponse.json();
            if (jsonResponse.status === "Success") {
                console.log('Swap successful:', JSON.stringify(jsonResponse, null, 2));
                console.log(`https://solscan.io/tx/${jsonResponse.signature}`);
            } else {
                console.error('Swap failed:', JSON.stringify(jsonResponse, null, 2));
                console.log(`https://solscan.io/tx/${jsonResponse.signature}`);
            }
        }
    }
})

bot.start()