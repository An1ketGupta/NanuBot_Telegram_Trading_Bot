import { InlineKeyboard } from "grammy";

export const startKeyboard = new InlineKeyboard()
    .text("Buy", "buyHandler")
    .text("Sell", "sellHandler").row()
    .text("Fund", "fundHandler")
    .text("Wallet", "walletHandler").row()
    .text("Export Secret Key", "secretKeyHandler")


export const zeroBalanceKeyboard = new InlineKeyboard()
    .text("Wallet", "walletHandler").row()
    .text("Fund", "fundHandler").row()
    .text("Close", "closeHandler").row()

export const tokenBuyKeyboard = new InlineKeyboard()
    .text("Buy 0.1 Sol", "0.1SolHandler")
    .text("Buy 1.0 Sol", "1SolHandler")
    .text("Buy 0.5 Sol", "0.5SolHandler").row()
    .text("Buy X Sol", "xSolHandler").row()
    .text("Refresh", "refreshHandler")
    .text("Slippage - 1%", "slippageHandler").row()
    .text("Close", "closeHandler")

export const tokenSellKeyboard = new InlineKeyboard()
    .text("Sell 25%", "25SellHandler")
    .text("Sell 50%", "50SellHandler").row()
    .text("Sell 100%", "100SellHandler")
    .text("Sell X Amount", "XSellHandler").row()
    .text("Refresh", "refreshHandler")
    .text("Slippage - 1%", "slippageHandler").row()
    .text("Close", "closeHandler")



export const walletKeyboard = new InlineKeyboard()
    .text("🔄 Refresh", "refreshHandler") // Calls this same handler again to update
    .text("🔑 Export Private Key", "secretKeyHandler") // New handler for security
    .row()
    .text("❌ Close", "closeHandler");