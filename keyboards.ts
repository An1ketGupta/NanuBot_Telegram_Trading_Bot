import { InlineKeyboard } from "grammy";

export const startKeyboard = new InlineKeyboard()
    .text("Buy" , "buyHandler")
    .text("Sell", "sellHandler").row()
    .text("Fund", "fundHandler")
    .text("Refer a friend", "referalHandler").row()
    .text("Refresh", "refreshHandler").row()
    .text("Wallet" , "walletHandler").row()


export const zeroBalanceKeyboard = new InlineKeyboard()
    .text("Wallet" , "walletHandler").row()
    .text("Fund", "fundHandler").row()
    .text("Close", "closeHandler").row()

export const tokenBuyKeyboard = new InlineKeyboard()
    .text("Buy 0.1 Sol", "0.1SolHandler")
    .text("Buy 1.0 Sol", "1SolHandler")
    .text("Buy 0.5 Sol", "0.5SolHandler").row()
    .text("Buy X Sol", "xSolHandler").row()
    .text("Refresh", "refreshHandler")
    .text("Slippage -> 10%", "slippageHandler").row()
    .text("Close", "closeHandler")