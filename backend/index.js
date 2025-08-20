// --- START OF FILE backend/index.js ---
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios"); // Still needed for invoice creation/checking
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const Client = require("@replit/database");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// --- Import Fortune Logic ---
const { drawCards, calculateFortune } = require("./fortuneLogic.js");
// --- Import Withdrawal Routes Factory ---
const createWithdrawalRouter = require("./withdrawalRoutes.js"); // Import the router factory

const app = express();
const db = new Client(); // Initialize DB Client
const PROFIT_AMOUNT = 4; // Sats per play going to profit wallet

// --- Configuration ---
const config = {
    // Store config in an object for easier passing
    lnbitsUrl: process.env.LNBITS_URL,
    lnbitsMainInvoiceKey: process.env.LNBITS_MAIN_INVOICE_KEY,
    lnbitsMainAdminKey: process.env.LNBITS_MAIN_ADMIN_KEY,
    lnbitsPayoutAdminKey: process.env.LNBITS_PAYOUT_ADMIN_KEY,
    lnbitsProfitAdminKey: process.env.LNBITS_PROFIT_ADMIN_KEY,
    PAYOUT_WALLET_ID: process.env.LNBITS_PAYOUT_WALLET_ID,
    PAYMENT_AMOUNT_SATS: parseInt(process.env.PAYMENT_AMOUNT_SATS || "21"), // Read from env or default 21
    INVOICE_MEMO: "Madame Satoshi Reading",
    LNURL_WITHDRAW_TITLE: "Madame Satoshi Winnings",
    JACKPOT_DB_KEY: "currentJackpotPool_v1",
    JACKPOT_CONTRIBUTION: 0, // Will be calculated below
    MIN_JACKPOT_SEED: 500,
    defaultPort: 3001,
};
// Calculate contribution based on final payment amount
config.JACKPOT_CONTRIBUTION = Math.floor(config.PAYMENT_AMOUNT_SATS * 0.8);

// --- Middleware & Config Check ---
// Check essential keys needed for core operation and withdrawals
if (
    !config.lnbitsUrl ||
    !config.lnbitsMainInvoiceKey ||
    !config.lnbitsPayoutAdminKey ||
    !config.lnbitsMainAdminKey ||
    !config.lnbitsProfitAdminKey
) {
    console.error(
        "!!! CRITICAL: Missing essential LNbits secrets (URL, Main Invoice, Main Admin, Payout Admin) !!! Check .env file.",
    );
    // Consider exiting if config is invalid: process.exit(1);
} else {
    console.log("All required LNbits secrets appear present.");
}
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// --- DB Helper Functions (Used by multiple routes) ---
// These are defined here and passed via closure/config to withdrawal routes if needed,
// or withdrawal routes can define their own DB interactions using the passed 'db' client.
// Keeping them here allows reuse by /draw, /draw-from-balance etc.
async function transferToProfitWallet(config, amount, memo) {
    if (
        !config.lnbitsProfitAdminKey ||
        !config.lnbitsMainAdminKey ||
        !config.lnbitsUrl
    ) {
        console.error(
            "Profit transfer failed: Missing Profit Admin Key, Main Admin Key, or LNbits URL in config.",
        );
        throw new Error("Profit transfer configuration missing.");
    }
    if (amount <= 0) {
        console.log("Profit transfer skipped: Amount is zero or less.");
        return false; // Nothing to transfer
    }

    let profitInvoice = null;
    try {
        // Step 1: Create internal invoice on PROFIT wallet
        console.log(` -> Creating profit invoice for ${amount} sats...`);
        const invoicePayload = {
            out: false, // Incoming to profit wallet
            amount: amount,
            memo: memo || "Madame Satoshi Profit Share",
            webhook: "", // No webhook needed for this internal transfer
        };
        const invResponse = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`,
            invoicePayload,
            {
                headers: {
                    "X-Api-Key": config.lnbitsProfitAdminKey, // Use PROFIT wallet admin key
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            },
        );
        if (!invResponse.data?.payment_request) {
            throw new Error(
                "LNbits did not return payment_request for profit invoice.",
            );
        }
        profitInvoice = invResponse.data.payment_request;
        console.log(` -> Profit invoice created.`);
    } catch (invError) {
        console.error(
            "Profit invoice creation failed:",
            invError.response?.data || invError.message,
        );
        // Don't re-throw immediately, allow function to return false if needed,
        // but log the underlying error. The calling function might decide how critical this is.
        throw new Error(
            `Profit invoice creation failed: ${invError.response?.data?.detail || invError.message}`,
        );
    }

    try {
        // Step 2: Pay profit invoice from MAIN wallet
        console.log(` -> Paying profit invoice from Main Wallet...`);
        const paymentPayload = { out: true, bolt11: profitInvoice }; // Outgoing from Main
        const paymentResponse = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`,
            paymentPayload,
            {
                headers: {
                    "X-Api-Key": config.lnbitsMainAdminKey, // Use MAIN wallet admin key
                    "Content-Type": "application/json",
                },
                timeout: 45000, // Longer timeout for payment
            },
        );

        // Check for specific errors or lack of payment hash
        if (!paymentResponse.data?.payment_hash) {
            if (
                paymentResponse.data?.detail
                    ?.toLowerCase()
                    .includes("insufficient balance")
            ) {
                console.error(
                    "!!! PROFIT TRANSFER FAILED: Operator Main Wallet has insufficient funds. !!!",
                );
                throw new Error(
                    "Operator Main Wallet insufficient funds for profit transfer.",
                );
            }
            throw new Error(
                paymentResponse.data?.detail ||
                    "Profit transfer payment failed (no payment_hash).",
            );
        }

        console.log(
            ` -> Profit transfer successful. Payment Hash: ${paymentResponse.data.payment_hash.substring(0, 10)}...`,
        );
        return true; // Indicate success
    } catch (paymentError) {
        console.error(
            "Profit transfer payment failed:",
            paymentError.response?.data || paymentError.message,
        );
        // Re-throw specific insufficient funds error if caught earlier
        if (paymentError.message?.includes("insufficient funds")) {
            throw paymentError;
        }
        // Throw generic payment error
        throw new Error(
            `Profit transfer payment failed: ${paymentError.response?.data?.detail || paymentError.message}`,
        );
    }
}
async function getUserBalance(sessionId) {
    if (!sessionId) return 0;
    const b = await db.get(`balance_${sessionId}`);
    return Math.max(0, parseInt(b || 0));
}
async function updateUserBalance(sessionId, amountToAdd) {
    if (!sessionId || isNaN(amountToAdd)) return 0;
    const c = await getUserBalance(sessionId);
    const n = Math.max(0, c + Math.floor(amountToAdd));
    await db.set(`balance_${sessionId}`, n);
    console.log(
        ` -> Session ${sessionId.substring(0, 6)} balance update: ${c} + ${Math.floor(amountToAdd)} = ${n}`,
    );
    return n;
}
async function resetUserBalance(sessionId) {
    if (!sessionId) return false;
    await db.set(`balance_${sessionId}`, 0);
    console.log(
        ` -> Session ${sessionId.substring(0, 6)} balance reset via withdrawal claim.`,
    );
    return true;
} // This specific reset is now called by withdrawalRoutes
async function getJackpot() {
    const p = await db.get(config.JACKPOT_DB_KEY);
    return Math.max(0, parseInt(p || 0));
}
async function updateJackpot(amountChange) {
    if (isNaN(amountChange)) return await getJackpot();
    const c = await getJackpot();
    const n = Math.max(0, c + Math.floor(amountChange));
    await db.set(config.JACKPOT_DB_KEY, n);
    console.log(
        ` -> Jackpot DB update: ${c} + ${Math.floor(amountChange)} = ${n}`,
    );
    return n;
}
const getBonusFlagKey = (sessionId) => `bonus_given_${sessionId}`;
async function hasReceivedBonus(sessionId) {
    return (await db.get(getBonusFlagKey(sessionId))) === true;
}
async function markBonusReceived(sessionId) {
    await db.set(getBonusFlagKey(sessionId), true);
    console.log(` -> Bonus flag set for ${sessionId.substring(0, 6)}.`);
}

// --- API Routes ---
app.get("/api/session", (req, res) => {
    const id = uuidv4();
    console.log(`Generated session ID: ${id.substring(0, 6)}...`);
    res.json({ sessionId: id });
});
app.get("/api/balance/:sessionId", async (req, res) => {
    const id = req.params.sessionId;
    if (!id) return res.status(400).json({ error: "ID required." });
    try {
        const b = await getUserBalance(id);
        res.json({ balance: b });
    } catch (e) {
        console.error(`Err fetch balance ${id.substring(0, 6)}:`, e);
        res.status(500).json({ error: "Failed fetch balance." });
    }
});

// --- Draw Handler (Invoice Paid) ---
app.post("/api/draw", async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required." });
    }
    console.log(
        `Request received: /api/draw for session ${sessionId.substring(0, 6)}... (Invoice Flow)`,
    );
    try {
        await getUserBalance(sessionId); // Session check
        const isFirstPlay = !(await hasReceivedBonus(sessionId));
        if (isFirstPlay) {
            console.log(
                ` -> First play detected for session ${sessionId.substring(0, 6)}.`,
            );
            const actualSatsWon = config.PAYMENT_AMOUNT_SATS;
            const finalFortune = `Beginner's luck! Madame Satoshi returns your ${actualSatsWon} sat stake! Use it wisely...`;
            let poolAfterContribution = await updateJackpot(
                config.JACKPOT_CONTRIBUTION,
            );
            await broadcastJackpotUpdate();
            let finalPoolValue = await updateJackpot(-actualSatsWon);
            await broadcastJackpotUpdate();
            let userNewTotalBalance = await updateUserBalance(
                sessionId,
                actualSatsWon,
            );
            await markBonusReceived(sessionId);
            let drawnCardObjects = [
                {
                    name: "XXI Ace of Pentacles",
                    number: "XXI",
                    image: "21-ace-of-pentacles.webp",
                },
                {
                    name: "X Wheel of Fortune",
                    number: "X",
                    image: "10-wheel-of-fortune.webp",
                },
                { name: "XI Justice", number: "XI", image: "11-justice.webp" },
            ];
            console.log(` -> First play awarded: ${actualSatsWon} sats.`);
            console.log(" -> Draw Results (First Play):", {
                cards: drawnCardObjects.map((c) => c.name),
                fortune: finalFortune,
            });
            res.json({
                cards: drawnCardObjects,
                fortune: finalFortune,
                sats_won_this_round: actualSatsWon,
                user_balance: userNewTotalBalance,
                current_jackpot: finalPoolValue,
            });
        } else {
            console.log(
                ` -> Regular play for session ${sessionId.substring(0, 6)}.`,
            );
            let poolBeforeWinCalc = await updateJackpot(
                config.JACKPOT_CONTRIBUTION,
            );
            await broadcastJackpotUpdate();
            try {
                console.log(
                    ` -> Attempting profit transfer of ${PROFIT_AMOUNT} sats...`,
                );
                await transferToProfitWallet(
                    config,
                    PROFIT_AMOUNT,
                    `Profit from session ${sessionId.substring(0, 6)}`,
                );
                console.log(` -> Profit transfer attempt finished.`);
            } catch (profitTransferError) {
                // Log the error but allow the game to proceed
                console.error(
                    `!!! FAILED TO TRANSFER PROFIT: ${profitTransferError.message} !!! Game will proceed.`,
                );
                // Depending on severity, you might decide differently,
                // but for now, we let the user play even if profit transfer fails.
            }
            let drawnCardObjects = drawCards();
            const fortuneResult = calculateFortune(
                drawnCardObjects,
                poolBeforeWinCalc,
                config.MIN_JACKPOT_SEED,
            );
            let actualSatsWon = fortuneResult.sats_won;
            let finalFortune = fortuneResult.fortune;
            let finalPoolValue = poolBeforeWinCalc;
            let userNewTotalBalance = await getUserBalance(sessionId);
            if (actualSatsWon > 0) {
                console.log(` -> Win Calculated: ${actualSatsWon} sats`);
                if (poolBeforeWinCalc >= actualSatsWon) {
                    finalPoolValue = await updateJackpot(-actualSatsWon);
                    await broadcastJackpotUpdate();
                    userNewTotalBalance = await updateUserBalance(
                        sessionId,
                        actualSatsWon,
                    );
                } else {
                    console.warn(
                        ` !! Pool (${poolBeforeWinCalc}) less than win (${actualSatsWon}). Awarding available.`,
                    );
                    actualSatsWon = poolBeforeWinCalc;
                    if (actualSatsWon > 0) {
                        finalPoolValue = await updateJackpot(-actualSatsWon);
                        await broadcastJackpotUpdate();
                        userNewTotalBalance = await updateUserBalance(
                            sessionId,
                            actualSatsWon,
                        );
                    } else {
                        console.warn(` !! Pool empty.`);
                        actualSatsWon = 0;
                    }
                    finalFortune += ` (Pool limit reached)`;
                }
            } else {
                userNewTotalBalance = await getUserBalance(sessionId);
                finalPoolValue = await getJackpot();
            }
            console.log(" -> Draw Results (Regular Play):", {
                cards: drawnCardObjects.map((c) => c.name).join(", "),
                fortune: finalFortune.substring(0, 30) + "...",
                sats_won: actualSatsWon,
                balance: userNewTotalBalance,
                pool: finalPoolValue,
            });
            res.json({
                cards: drawnCardObjects,
                fortune: finalFortune,
                sats_won_this_round: actualSatsWon,
                user_balance: userNewTotalBalance,
                current_jackpot: finalPoolValue,
            });
        }
    } catch (error) {
        console.error("Error in /api/draw handler:", error);
        if (!res.headersSent) {
            if (error.message?.includes("Session")) {
                res.status(400).json({ error: "Invalid session." });
            } else {
                res.status(500).json({ error: "Internal error during draw." });
            }
        }
    }
});

// --- Draw Handler (Pay from Balance) ---
app.post("/api/draw-from-balance", async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required." });
    }
    console.log(
        `Request received: /api/draw-from-balance for session ${sessionId.substring(0, 6)}...`,
    );
    try {
        const currentBalance = await getUserBalance(sessionId);
        console.log(
            ` -> Balance check for ${sessionId.substring(0, 6)}: ${currentBalance} sats`,
        );
        if (currentBalance < config.PAYMENT_AMOUNT_SATS) {
            console.warn(
                ` -> Insufficient balance (${currentBalance}) for play cost (${config.PAYMENT_AMOUNT_SATS}).`,
            );
            return res.status(400).json({
                error: `Insufficient balance. Requires ${config.PAYMENT_AMOUNT_SATS} sats.`,
            });
        }
        console.log(
            ` -> Sufficient balance. Deducting ${config.PAYMENT_AMOUNT_SATS} sats...`,
        );
        let balanceAfterDeduction = await updateUserBalance(
            sessionId,
            -config.PAYMENT_AMOUNT_SATS,
        );
        console.log(
            ` -> Balance after deduction for ${sessionId.substring(0, 6)}: ${balanceAfterDeduction} sats`,
        );
        console.log(
            ` -> Adding ${config.JACKPOT_CONTRIBUTION} sats to jackpot...`,
        );
        let poolBeforeWinCalc = await updateJackpot(
            config.JACKPOT_CONTRIBUTION,
        );
        await broadcastJackpotUpdate();
        console.log(` -> Performing draw...`);
        let drawnCardObjects = drawCards();
        const fortuneResult = calculateFortune(
            drawnCardObjects,
            poolBeforeWinCalc,
            config.MIN_JACKPOT_SEED,
        );
        let actualSatsWon = fortuneResult.sats_won;
        let finalFortune = fortuneResult.fortune;
        let finalPoolValue = poolBeforeWinCalc;
        let finalUserBalance = balanceAfterDeduction;
        if (actualSatsWon > 0) {
            console.log(` -> Win Calculated: ${actualSatsWon} sats`);
            if (poolBeforeWinCalc >= actualSatsWon) {
                console.log(
                    ` -> Awarding win. Deducting ${actualSatsWon} from pool, adding to user.`,
                );
                finalPoolValue = await updateJackpot(-actualSatsWon);
                await broadcastJackpotUpdate();
                finalUserBalance = await updateUserBalance(
                    sessionId,
                    actualSatsWon,
                );
            } else {
                console.warn(
                    ` !! Pool (${poolBeforeWinCalc}) less than win (${actualSatsWon}). Awarding available.`,
                );
                actualSatsWon = poolBeforeWinCalc;
                if (actualSatsWon > 0) {
                    finalPoolValue = await updateJackpot(-actualSatsWon);
                    await broadcastJackpotUpdate();
                    finalUserBalance = await updateUserBalance(
                        sessionId,
                        actualSatsWon,
                    );
                } else {
                    console.warn(` !! Pool empty.`);
                    actualSatsWon = 0;
                }
                finalFortune += ` (Pool limit reached)`;
            }
        } else {
            finalUserBalance = await getUserBalance(sessionId);
            finalPoolValue = await getJackpot();
        }
        console.log(" -> Draw from Balance Results:", {
            fortune: finalFortune.substring(0, 30) + "...",
            sats_won: actualSatsWon,
            balance: finalUserBalance,
            pool: finalPoolValue,
        });
        res.json({
            cards: drawnCardObjects,
            fortune: finalFortune,
            sats_won_this_round: actualSatsWon,
            user_balance: finalUserBalance,
            current_jackpot: finalPoolValue,
        });
    } catch (error) {
        console.error("Error in /api/draw-from-balance handler:", error);
        if (!res.headersSent) {
            res.status(500).json({
                error: "Internal error during draw from balance.",
            });
        }
    }
});

// --- Invoice Creation ---
app.post("/api/create-invoice", async (req, res) => {
    console.log(
        `Request received: /api/create-invoice for ${config.PAYMENT_AMOUNT_SATS} sats`,
    );
    if (!config.lnbitsUrl || !config.lnbitsMainInvoiceKey) {
        console.error(" /api/create-invoice error: Config missing.");
        return res
            .status(500)
            .json({ error: "LNbits backend config missing." });
    }
    try {
        console.log(` -> Contacting LNbits at ${config.lnbitsUrl}...`);
        const response = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`,
            {
                out: false,
                amount: config.PAYMENT_AMOUNT_SATS,
                memo: config.INVOICE_MEMO,
            },
            {
                headers: {
                    "X-Api-Key": config.lnbitsMainInvoiceKey,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            },
        );
        if (!response.data?.payment_hash || !response.data?.payment_request) {
            console.error(" -> Invalid LNbits response:", response.data);
            throw new Error("Invalid LNbits API response creating invoice.");
        }
        console.log(
            " -> Invoice created. Hash:",
            response.data.payment_hash.substring(0, 10) + "...",
        );
        res.json({
            payment_hash: response.data.payment_hash,
            payment_request: response.data.payment_request,
        });
    } catch (error) {
        console.error("--- ERROR creating invoice ---");
        if (error.response) {
            console.error("LNbits Status:", error.response.status);
            console.error("LNbits Data:", error.response.data);
        } else if (error.request) {
            console.error(
                "No response from LNbits.",
                error.code === "ECONNABORTED"
                    ? "(Timeout)"
                    : `Code: ${error.code}`,
            );
        } else {
            console.error("Axios Error:", error.message);
        }
        if (!res.headersSent)
            res.status(500).json({
                error: "Failed create invoice via LNbits.",
            });
    }
});

// --- Invoice Checking ---
app.get("/api/check-invoice/:payment_hash", async (req, res) => {
    const paymentHash = req.params.payment_hash;
    const apiKey = config.lnbitsMainInvoiceKey; // Key for regular play invoices

    if (!config.lnbitsUrl || !apiKey) {
        console.error(
            " /api/check-invoice error: LNbits service config missing (URL or MainInvoiceKey).",
        );
        return res
            .status(503)
            .json({ error: "LNbits service misconfigured.", paid: false });
    }
    if (!paymentHash || paymentHash.length !== 64) {
        console.error(
            ` /api/check-invoice error: Invalid payment hash received: ${paymentHash}`,
        );
        return res
            .status(400)
            .json({ error: "Invalid payment hash provided.", paid: false });
    }

    const checkUrl = `${config.lnbitsUrl}/api/v1/payments/${paymentHash}`;
    console.log(
        ` -> Checking Play Invoice status at: [${checkUrl}] for hash ${paymentHash.substring(0, 10)}...`,
    );

    try {
        const response = await axios.get(checkUrl, {
            headers: {
                "X-Api-Key": apiKey,
                "Content-Type": "application/json",
            },
            timeout: 10000, // 10 seconds timeout
        });

        // DETAILED LOG of the entire response from LNbits
        console.log(
            `LNbits full response for Play Invoice ${paymentHash.substring(0, 10)}:`,
            JSON.stringify(response.data, null, 2),
        );

        const isPaid = response.data?.paid === true;

        if (isPaid) {
            console.log(
                ` -> Play Invoice ${paymentHash.substring(0, 10)}... CONFIRMED PAID via LNbits. Amount: ${response.data.details?.amount / 1000} sats.`,
            );
        } else {
            console.log(
                ` -> Play Invoice ${paymentHash.substring(0, 10)}... NOT PAID according to LNbits (paid: ${response.data?.paid}).`,
            );
        }
        res.json({ paid: isPaid });
    } catch (error) {
        console.error(
            `Error checking Play Invoice ${paymentHash.substring(0, 10)} at URL [${checkUrl}]:`,
        );
        if (error.response) {
            console.error(
                `  LNbits Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`,
            );
            // If LNbits returns 404, it means the invoice doesn't exist or wasn't found (hence not paid)
            if (error.response.status === 404) {
                console.log(
                    `  -> Invoice ${paymentHash.substring(0, 10)}... not found on LNbits (Interpreted as Not Paid).`,
                );
                return res.json({ paid: false }); // Explicitly return paid: false
            }
        } else if (error.request) {
            console.error(
                "  No response received from LNbits. Request details:",
                error.request,
            );
        } else {
            console.error(
                "  Error setting up the request to LNbits:",
                error.message,
            );
        }
        // For other errors (network, timeout, etc.), send a 503 status
        return res.status(503).json({
            error: "Failed to check Play Invoice status with LNbits.",
            details: error.message || "Unknown check error",
            paid: false,
        });
    }
});

// --- Deposit Invoice Creation (Custom Amount) ---
app.post("/api/create-deposit-invoice", async (req, res) => {
    const { amount, sessionId } = req.body; // Get amount and session from request

    // Basic Validation
    if (!sessionId) {
        console.error("/api/create-deposit-invoice error: Session ID missing.");
        return res.status(400).json({ error: "Session ID is required." });
    }
    const depositAmountSats = parseInt(amount);
    if (isNaN(depositAmountSats) || depositAmountSats <= 0) {
        console.error(
            `/api/create-deposit-invoice error: Invalid amount ${amount}`,
        );
        return res
            .status(400)
            .json({ error: "Invalid deposit amount provided." });
    }

    console.log(
        `Request received: /api/create-deposit-invoice for ${depositAmountSats} sats (Session: ${sessionId.substring(0, 6)}...)`,
    );

    if (!config.lnbitsUrl || !config.lnbitsMainInvoiceKey) {
        console.error(
            "/api/create-deposit-invoice error: LNbits config missing.",
        );
        return res
            .status(500)
            .json({ error: "LNbits backend configuration missing." });
    }

    try {
        const memo = `Deposit ${depositAmountSats} sats for Madame Satoshi (Session: ${sessionId.substring(0, 6)})`;
        console.log(
            ` -> Contacting LNbits at ${config.lnbitsUrl} for deposit invoice...`,
        );

        const response = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`,
            {
                out: false, // We want to receive funds
                amount: depositAmountSats, // Use the amount from the request
                memo: memo,
                // webhook: Optional - can add later to update balance automatically
            },
            {
                headers: {
                    "X-Api-Key": config.lnbitsMainInvoiceKey, // Use the MAIN wallet key to receive deposits
                    "Content-Type": "application/json",
                },
                timeout: 15000, // Standard timeout
            },
        );

        if (!response.data?.payment_hash || !response.data?.payment_request) {
            console.error(
                " -> Invalid LNbits response for deposit invoice:",
                response.data,
            );
            throw new Error(
                "Invalid LNbits API response creating deposit invoice.",
            );
        }

        console.log(
            " -> Deposit Invoice created. Hash:",
            response.data.payment_hash.substring(0, 10) + "...",
        );
        res.json({
            payment_hash: response.data.payment_hash,
            payment_request: response.data.payment_request,
            amount: depositAmountSats, // Optionally return amount for confirmation
        });
    } catch (error) {
        console.error("--- ERROR creating deposit invoice ---");
        if (error.response) {
            console.error("LNbits Status:", error.response.status);
            console.error("LNbits Data:", error.response.data);
        } else if (error.request) {
            console.error(
                "No response from LNbits.",
                error.code === "ECONNABORTED"
                    ? "(Timeout)"
                    : `Code: ${error.code}`,
            );
        } else {
            console.error("Axios Error:", error.message);
        }
        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to create deposit invoice via LNbits.",
            });
        }
    }
});

// --- Check Deposit Invoice Status ---
app.get("/api/check-deposit-invoice/:payment_hash", async (req, res) => {
    const paymentHash = req.params.payment_hash;
    // Use the MAIN INVOICE KEY to check invoices on the main wallet (where deposits go)
    const apiKey = config.lnbitsMainInvoiceKey;

    if (!config.lnbitsUrl || !apiKey) {
        console.error(
            " /api/check-deposit-invoice error: LNbits service config missing (URL or MainInvoiceKey).",
        );
        return res
            .status(503)
            .json({ error: "LNbits service misconfigured.", paid: false });
    }
    if (!paymentHash || paymentHash.length !== 64) {
        console.error(
            ` /api/check-deposit-invoice error: Invalid payment hash: ${paymentHash}`,
        );
        return res
            .status(400)
            .json({ error: "Invalid payment hash provided.", paid: false });
    }

    const checkUrl = `${config.lnbitsUrl}/api/v1/payments/${paymentHash}`;
    console.log(
        ` -> Checking Deposit Invoice status at: [${checkUrl}] for hash ${paymentHash.substring(0, 10)}...`,
    );

    try {
        const response = await axios.get(checkUrl, {
            headers: {
                "X-Api-Key": apiKey,
                "Content-Type": "application/json",
            },
            timeout: 10000,
        });

        // DETAILED LOG of the entire response from LNbits
        console.log(
            `LNbits full response for Deposit Invoice ${paymentHash.substring(0, 10)}:`,
            JSON.stringify(response.data, null, 2),
        );

        const isPaid = response.data?.paid === true;

        if (isPaid) {
            console.log(
                ` -> Deposit Invoice ${paymentHash.substring(0, 10)}... CONFIRMED PAID via LNbits. Amount: ${response.data.details?.amount / 1000} sats.`,
            );
        } else {
            console.log(
                ` -> Deposit Invoice ${paymentHash.substring(0, 10)}... NOT PAID according to LNbits (paid: ${response.data?.paid}).`,
            );
        }
        res.json({ paid: isPaid });
    } catch (error) {
        console.error(
            `Error checking Deposit Invoice ${paymentHash.substring(0, 10)}:`,
        );
        if (error.response) {
            console.error(
                `  LNbits Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`,
            );
            if (error.response.status === 404) {
                console.log(
                    `  -> Deposit Invoice ${paymentHash.substring(0, 10)}... not found on LNbits (Interpreted as Not Paid).`,
                );
                return res.json({ paid: false });
            }
        } else if (error.request) {
            console.error(
                "  No response received from LNbits for deposit check.",
            );
        } else {
            console.error(
                "  Error setting up the request to LNbits for deposit check:",
                error.message,
            );
        }
        return res.status(503).json({
            error: "Failed to check Deposit Invoice status with LNbits.",
            paid: false,
        });
    }
}); // Make sure this is the only closing for this app.get

// --- Confirm Deposit Payment and Update Balance ---
app.post("/api/confirm-deposit-payment", async (req, res) => {
    const { sessionId, paymentHash, amount } = req.body;

    // Validation
    if (!sessionId || !paymentHash || !amount || amount <= 0) {
        console.error("/api/confirm-deposit-payment error: Missing data.", {
            sessionId: sessionId?.substring(0, 6),
            paymentHash: paymentHash?.substring(0, 6),
            amount,
        });
        return res
            .status(400)
            .json({ error: "Missing session, hash, or valid amount." });
    }
    const depositAmountSats = parseInt(amount);
    if (isNaN(depositAmountSats) || depositAmountSats <= 0) {
        return res.status(400).json({ error: "Invalid amount." });
    }

    const apiKey = config.lnbitsMainInvoiceKey; // Key to check the invoice
    if (!config.lnbitsUrl || !apiKey) {
        console.error(
            "/api/confirm-deposit-payment error: LNbits config missing.",
        );
        return res.status(500).json({ error: "Backend configuration error." });
    }

    console.log(
        `Request received: /api/confirm-deposit-payment for Session: ${sessionId.substring(0, 6)}, Amount: ${depositAmountSats}`,
    );

    try {
        // **Security Check:** Re-verify payment status with LNbits
        const checkUrl = `${config.lnbitsUrl}/api/v1/payments/${paymentHash}`; // CORRECTED LINE using backticks ``

        console.log(
            ` -> Re-verifying payment status for ${paymentHash.substring(0, 10)}... URL: [${checkUrl}]`, // Added URL to log
        );
        const checkResponse = await axios.get(checkUrl, {
            headers: {
                "X-Api-Key": apiKey,
                "Content-Type": "application/json",
            },
            timeout: 10000,
        });

        if (checkResponse.data?.paid !== true) {
            console.warn(
                ` -> Payment verification failed for ${paymentHash.substring(0, 10)}. Status: ${checkResponse.data?.paid}`,
            );
            throw new Error("Payment not confirmed by LNbits.");
        }
        console.log(
            ` -> Payment re-verified for ${paymentHash.substring(0, 10)}.`,
        );

        // ---- START OF FIX ----
        // Get the actual paid amount from LNbits response (usually in millisatoshis)
        const actualPaidMillisats = checkResponse.data.details?.amount; // Adjust path if necessary based on LNbits response structure

        if (
            typeof actualPaidMillisats !== "number" ||
            actualPaidMillisats <= 0
        ) {
            console.error(
                ` -> Invalid or zero paid amount from LNbits for ${paymentHash.substring(0, 10)}:`,
                actualPaidMillisats,
            );
            throw new Error(
                "Could not retrieve a valid paid amount from LNbits.",
            );
        }
        const actualPaidSats = Math.floor(actualPaidMillisats / 1000);
        console.log(
            ` -> Verified paid amount from LNbits: ${actualPaidSats} sats.`,
        );

        // Original client-sent amount for logging/comparison if needed, but DO NOT use for balance update
        const clientReportedAmountSats = parseInt(amount);
        if (actualPaidSats !== clientReportedAmountSats) {
            console.warn(
                ` !! Discrepancy: Client reported ${clientReportedAmountSats} sats, LNbits confirmed ${actualPaidSats} sats for ${paymentHash.substring(0, 10)}. Using LNbits amount.`,
            );
        }
        // ---- END OF FIX ----

        // Payment confirmed, now update the balance
        console.log(
            ` -> Updating balance for session <span class="math-inline">\{sessionId\.substring\(0,6\)\} by \+</span>{depositAmountSats}`,
        );
        const newBalance = await updateUserBalance(
            sessionId,
            depositAmountSats,
        ); // Use existing helper
        console.log(
            ` -> New balance for session ${sessionId.substring(0, 6)}: ${newBalance}`,
        );

        // Respond with success and the new balance
        res.json({ success: true, newBalance: newBalance });

        // Notify via WebSocket (if you implement that later)
        // await broadcastBalanceUpdate(sessionId, newBalance);
    } catch (error) {
        console.error(
            "--- ERROR during deposit confirmation/balance update ---",
        );
        console.error("Details:", error.message);
        if (error.response) {
            // Axios error
            console.error("LNbits Status:", error.response.status);
            console.error("LNbits Data:", error.response.data);
        }
        res.status(500).json({
            error:
                error.message ||
                "Failed to confirm deposit and update balance.",
        });
    }
});

// --- Mount Withdrawal Routes --- (Ensure the new endpoint is above this line)
const withdrawalRouter = createWithdrawalRouter(db, config);
app.use("/api", withdrawalRouter);

// --- Simple Test Endpoint ---
app.get("/ping", (req, res) => {
    console.log(">>> Received /ping request <<<");
    res.send("pong");
});

// --- Catch-all Route ---
app.get("*", (req, res, next) => {
    // Added next
    if (req.path.startsWith("/api/") || req.path.includes(".")) {
        console.log(
            `Catch-all: Passing possible file/API request ${req.method} ${req.path}`,
        );
        next(); // Pass to default handlers
    } else {
        console.log(
            `Catch-all: Assuming frontend route, serving index.html for ${req.method} ${req.path}`,
        );
        res.sendFile(path.resolve(__dirname, "../frontend", "index.html"));
    }
});

// --- Start Server & WebSocket ---
const effectivePort = process.env.PORT || config.defaultPort;
const server = app.listen(effectivePort, "0.0.0.0", async () => {
    console.log(`Madame Satoshi Backend listening on port ${effectivePort}`);
    try {
        const initialJackpot = await getJackpot();
        console.log(`Initial Jackpot Pool loaded: ${initialJackpot} sats`);
        if (initialJackpot <= 0) {
            console.log(
                `Jackpot is ${initialJackpot}, seeding with ${config.MIN_JACKPOT_SEED} sats.`,
            );
            await updateJackpot(config.MIN_JACKPOT_SEED);
        }
    } catch (dbError) {
        console.error("!!! FAILED load/seed initial jackpot:", dbError);
    }
    console.log("--- LNbits Key Check ---");
    console.log(`LNbits URL: ${config.lnbitsUrl ? "PRESENT" : "MISSING!"}`);
    console.log(
        `Main Invoice Key: ${config.lnbitsMainInvoiceKey ? "PRESENT" : "MISSING!"}`,
    );
    console.log(
        `Main Admin Key: ${config.lnbitsMainAdminKey ? "PRESENT (Withdraw funding)" : "MISSING! (Withdraw funding fails)"}`,
    );
    console.log(
        `Payout Admin Key: ${config.lnbitsPayoutAdminKey ? "PRESENT (Needed for LNURL Withdraw)" : "MISSING! (LNURL fails)"}`,
    );
    console.log("------------------------");
    console.log(
        `Profit Admin Key: ${config.lnbitsProfitAdminKey ? "PRESENT" : "MISSING! (Profit transfer fails)"}`,
    );
    console.log("------------------------");
});

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ server });
let clients = new Set();
console.log("WebSocket Server initializing...");
wss.on("connection", async (ws) => {
    clients.add(ws);
    console.log(`WS Client connected. Total: ${clients.size}`);
    try {
        const currentPool = await getJackpot();
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({ type: "jackpotUpdate", amount: currentPool }),
            );
        }
    } catch (err) {
        console.error("Error sending initial jackpot via WS:", err);
    }
    ws.on("message", (message) => {
        try {
            const p = JSON.parse(message);
            console.log("Received WS message:", p);
        } catch (e) {
            console.warn("Received non-JSON WS message:", message.toString());
        }
    });
    ws.on("close", (code, reason) => {
        clients.delete(ws);
        const r = reason.toString();
        console.log(
            `WS Client disconnected. Code: ${code}, Reason: ${r ? r : "N/A"}. Total: ${clients.size}`,
        );
    });
    ws.on("error", (error) => {
        console.error("WS Connection Error:", error);
        clients.delete(ws);
    });
});
async function broadcastJackpotUpdate() {
    if (clients.size === 0) return;
    try {
        const currentPool = await getJackpot();
        const message = JSON.stringify({
            type: "jackpotUpdate",
            amount: currentPool,
        });
        console.log(
            `Broadcasting jackpot: ${currentPool} sats to ${clients.size} clients`,
        );
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message, (err) => {
                    if (err)
                        console.error(
                            "Error sending ws message to client:",
                            err,
                        );
                });
            }
        });
    } catch (dbError) {
        console.error("!!! FAILED get jackpot for broadcast:", dbError);
    }
}
console.log("WebSocket Server setup complete.");
process.on("SIGINT", () => {
    console.log("SIGINT received: closing servers");
    wss.close(() => console.log("WebSocket server closed."));
    server.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
    });
    setTimeout(() => {
        console.error("Force shutdown after timeout.");
        process.exit(1);
    }, 10000);
});

// --- END OF FILE backend/index.js ---
