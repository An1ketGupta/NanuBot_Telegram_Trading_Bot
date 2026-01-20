import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction, type GetProgramAccountsFilter } from "@solana/web3.js";
import { Bot, Context, session, type SessionFlavor } from "grammy";
import { startKeyboard, tokenBuyKeyboard, zeroBalanceKeyboard } from "./keyboards";
import axios, { all } from "axios";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const secretKeyData = new Uint8Array([
    192, 189, 246, 177, 55, 8, 252, 167, 215, 31, 17, 73, 107, 177, 3, 200,
    56, 32, 77, 17, 253, 62, 97, 102, 98, 204, 49, 245, 175, 221, 27, 176,
    112, 24, 191, 1, 78, 212, 82, 71, 40, 174, 141, 55, 87, 225, 49, 167,
    113, 45, 211, 198, 31, 41, 62, 80, 179, 164, 86, 36, 209, 241, 89, 252
]);

const keypair = Keypair.fromSecretKey(secretKeyData);
const KeyPairData: Record<number, Keypair> = {
    6296735010: keypair
};

const currentUserToken: Record<number, string> = {
    6296735010: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}

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

const bot = new Bot<myContext>(process.env.BOT_API_KEY!)
bot.use(session({
    initial: (): SessionData => ({ step: "idle" })
}));

bot.command("start", async (ctx) => {
    if (!ctx.from?.id) {
        throw new Error("No user detected.")
    }

    const userId = ctx.from.id;
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
        throw new Error("No user detected.")
    }

    const userId = ctx.from.id;
    const userPublicKey = KeyPairData[userId]?.publicKey
    if (!userPublicKey) {
        throw new Error("No PublicKey")
    }

    currentUserToken[userId] = ctx.message?.text!
    const userBalance = await connection.getBalance(userPublicKey)
    if (userBalance == 0) {
        await ctx.reply("You have 0 sol in your wallet.\n" + "Add some sol in your account -- ", {
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
        throw new Error("No user detected.")
    }

    const userId = ctx.from.id;
    const userPublicKey = KeyPairData[userId]?.publicKey
    if (!userPublicKey) {
        throw new Error("No PublicKey")
    }
    await ctx.answerCallbackQuery("Fetching your account details....")
    const userBalance = await connection.getBalance(userPublicKey)
    if (userBalance == 0) {
        await ctx.reply("You have 0 sol in your wallet.\n" + "Add some sol in your account -- ", {
            reply_markup: zeroBalanceKeyboard
        })
    }
    else {
        await ctx.reply(`Your balance- ${userBalance / 1e9} sol.\n` + `Enter the token address you want to buy:`)
    }
})

bot.callbackQuery("0.1SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) return ctx.reply("User not detected.");

        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];

        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const amountToSwap = 100000000;
        const userBalance = await rpcConnection.getBalance(userPublicKey);

        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const orderResponse = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentUserToken[userId],
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58(),
                slippageBps: "100"
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const { transaction: txBase64, requestId } = orderResponse.data;

        if (!txBase64) {
            return ctx.reply("No transaction returned from Jupiter Ultra API");
        }
        const transactionBuffer = Buffer.from(txBase64, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);

        const signedTxBytes = transaction.serialize();
        const signedTransaction = Buffer.from(signedTxBytes).toString('base64');
        const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute',
            {
                signedTransaction: signedTransaction,
                requestId: requestId,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.JUPITER_API,
                }
            }
        );

        const result = executeResponse.data;
        if (result.status === "Success" || result.signature) {
            await ctx.reply('Swap successful 🚀');
        } else {
            await ctx.reply('Swap submitted but status unknown.');
        }

    } catch (error: any) {
        return ctx.reply(`An error occurred. Please Try again"}`);
    }
});

bot.callbackQuery("0.5SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) return ctx.reply("User not detected.");

        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];

        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const amountToSwap = 500000000;
        const userBalance = await rpcConnection.getBalance(userPublicKey);

        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const orderResponse = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentUserToken[userId],
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58(),
                slippageBps: "100"
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const { transaction: txBase64, requestId } = orderResponse.data;

        if (!txBase64) {
            return ctx.reply("No transaction returned from Jupiter Ultra API");
        }
        const transactionBuffer = Buffer.from(txBase64, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);

        const signedTxBytes = transaction.serialize();
        const signedTransaction = Buffer.from(signedTxBytes).toString('base64');
        const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute',
            {
                signedTransaction: signedTransaction,
                requestId: requestId,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.JUPITER_API,
                }
            }
        );

        const result = executeResponse.data;
        if (result.status === "Success" || result.signature) {
            await ctx.reply('Swap successful');
        } else {
            await ctx.reply('Swap submitted but status unknown.');
        }

    } catch (error: any) {
        return ctx.reply(`An error occurred. Please Try again"}`);
    }
});

bot.callbackQuery("1SolHandler", async (ctx) => {
    try {
        await ctx.answerCallbackQuery("Fetching details...");
        if (!ctx.from?.id) return ctx.reply("User not detected.");

        const userId = ctx.from.id;
        const userKeypair = KeyPairData[userId];

        if (!userKeypair) {
            return ctx.reply("You do not have a wallet set up. Do /start first.");
        }

        const userPublicKey = userKeypair.publicKey;
        const amountToSwap = 1000000000;
        const userBalance = await rpcConnection.getBalance(userPublicKey);

        if (userBalance <= amountToSwap) {
            return ctx.reply("Insufficient balance.");
        }
        const orderResponse = await axios.get(`https://api.jup.ag/ultra/v1/order`, {
            params: {
                inputMint: "So11111111111111111111111111111111111111112",
                outputMint: currentUserToken[userId],
                amount: amountToSwap.toString(),
                taker: userPublicKey.toBase58(),
                slippageBps: "100"
            },
            headers: {
                'x-api-key': process.env.JUPITER_API
            }
        });

        const { transaction: txBase64, requestId } = orderResponse.data;

        if (!txBase64) {
            return ctx.reply("No transaction returned from Jupiter Ultra API");
        }
        const transactionBuffer = Buffer.from(txBase64, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);
        transaction.sign([userKeypair]);

        const signedTxBytes = transaction.serialize();
        const signedTransaction = Buffer.from(signedTxBytes).toString('base64');
        const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute',
            {
                signedTransaction: signedTransaction,
                requestId: requestId,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.JUPITER_API,
                }
            }
        );

        const result = executeResponse.data;
        if (result.status === "Success" || result.signature) {
            await ctx.reply('Swap successful 🚀');
        } else {
            await ctx.reply('Swap submitted but status unknown.');
        }

    } catch (error: any) {
        return ctx.reply(`An error occurred. Please Try again"}`);
    }
});

bot.callbackQuery("xSolHandler", async (ctx) => {
    if (!ctx.from.id) {
        return ctx.reply("No user detected.")
    }

    const userId = ctx.from.id;
    if (!KeyPairData[userId]) {
        return ctx.reply("You do not have a account. Do /start first")
    }
    await ctx.answerCallbackQuery("Fetching details")
    ctx.session.step = "waiting_for_amount"
    await ctx.reply("Enter the amount of Sol you want to buy for -- ")
})

bot.on("message:text", async (ctx) => {
    if (!ctx.from.id) {
        return ctx.reply("No user detected.")
    }

    const userId = ctx.from.id;
    if (!KeyPairData[userId]) {
        return ctx.reply("You do not have a account. Do /start first")
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
                    outputMint: currentUserToken[userId],
                    amount: amountToSwap.toString(),
                    taker: '3WuQpPyUZFbdQyCXsMJSRdstcpXNDKwq5ijCCffVkGMo',
                    slippageBps: "100"
                },
                headers: {
                    'x-api-key': process.env.JUPITER_API
                }
            });
            const data = response.data;
            console.log(data)
            console.log(data.routePlan)
            if (!data.transaction) {
                return ctx.reply("No transaction returned from Jupiter API");
            }
            const transactionBuffer = Buffer.from(data.transaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            transaction.sign([userKeypair]);
            const rawTransaction = transaction.serialize();
            const sendTransaction = Buffer.from(rawTransaction).toBase64();

            const executeResponse = await axios.post('https://api.jup.ag/ultra/v1/execute', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.JUPITER_API,
                },
                body: JSON.stringify({
                    signedTransaction: sendTransaction,
                    // @ts-ignore
                    requestId: response.requestId,
                }),
            })

            const result = executeResponse.data;
            if (result.status === "Success" || result.signature) {
                await ctx.reply('Swap successful 🚀');
            } else {
                await ctx.reply('Swap submitted but status unknown.');
            }
        }
    }
    ctx.session.step = "idle";
})

bot.callbackQuery("refreshHandler", async (ctx) => {
    await ctx.answerCallbackQuery("Refreshing...")
    if (!ctx.from.id) {
        return ctx.reply("No user detected.")
    }
    const userId = ctx.from.id;
    if (!KeyPairData[userId]) {
        return ctx.reply("You do not have a account. Do /start first")
    }
    const userKeyPair = KeyPairData[userId];
    await connection.getBalance(userKeyPair.publicKey)
    await ctx.reply("Refreshed your balance.")
})

bot.callbackQuery("sellHandler", async (ctx) => {
    if (!ctx.from?.id) return ctx.reply("No user detected.");
    await ctx.answerCallbackQuery("Fetching Wallet...");
    const userPublicKey = new PublicKey('7iVCXQn4u6tiTEfNVqbWSEsRdEi69E9oYsSMiepuECwi');

    const userTokenResponse = await rpcConnection.getParsedTokenAccountsByOwner(userPublicKey, {
        programId: TOKEN_PROGRAM_ID
    })
    const addressAmountMap: Record<string, number> = {}
    userTokenResponse.value.map((value) => {
        if (value.account.data.parsed.info.tokenAmount.uiAmount > 0) {
            const tokenAddress = value.account.data.parsed.info.mint;
            const amount = value.account.data.parsed.info.tokenAmount.uiAmount;
            addressAmountMap[tokenAddress] = amount;
        }
    });

    const entries = Object.entries(addressAmountMap);
    const length = entries.length;
    let fullMessage = "<b>💰 Your Portfolio:</b>\n\n";
    for (let i = 0; i < length; i += 10) {
        const batch = entries.slice(i, i + 10);
        const currParam = batch.map(([addr]) => addr).join(',');

        try {
            const response = await axios.get(`https://api.dexscreener.com/tokens/v1/solana/${currParam}`, {
                headers: { "Accept": "*/*" },
            });

            const pairs = response.data;

            // 2. Loop through the batch synchronously to build the string
            for (const [tokenAddress, amount] of batch) {
                const pairInfo = pairs.find((p:any) => p.baseToken.address === tokenAddress);

                if (pairInfo) {
                    const name = pairInfo.baseToken.name;
                    const symbol = pairInfo.baseToken.symbol;

                    // 3. Append to the single message string instead of replying immediately
                    fullMessage += `<b>${name} ($${symbol})</b>\n`;
                    fullMessage += `Amount: ${amount}\n`;
                    fullMessage += `-------------------\n`;
                }
            }

        } catch (error) {
            console.error("Error fetching batch:", error);
        }
    }
    await ctx.reply(fullMessage, { parse_mode: "HTML" });

});

bot.start()