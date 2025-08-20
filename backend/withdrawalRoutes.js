// --- START OF FILE backend/withdrawalRoutes.js ---
const express = require("express");
const axios = require("axios");

// Helper function to attempt LNbits API call for Withdraw Link Creation
async function attemptLnbitsWithdrawLink(config, payload) {
    try {
        const response = await axios.post(
            `${config.lnbitsUrl}/withdraw/api/v1/links`, // CORRECT Backticks
            payload,
            {
                headers: {
                    "X-Api-Key": config.lnbitsPayoutAdminKey,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            },
        );
        if (!response.data?.lnurl || !response.data?.id) {
            throw new Error("LNbits did not return a valid link or ID.");
        }
        return response.data;
    } catch (error) {
        console.error(
            "LNbits LNURL creation failed:",
            error.response?.data || error.message,
        );
        throw new Error(
            `LNbits LNURL creation error: ${error.response?.data?.detail || error.message}`, // CORRECT Backticks
        );
    }
}

// Helper function to attempt LNbits API call for Deleting Withdraw Link
async function attemptLnbitsDeleteWithdrawLink(config, linkId) {
    if (!linkId) return false; // Return status indication
    try {
        console.log(
            ` -> Attempting to delete previous LNURL Link ID: ${linkId}`, // CORRECT Backticks
        );
        await axios.delete(
            `${config.lnbitsUrl}/withdraw/api/v1/links/${linkId}`, // CORRECT Backticks
            {
                headers: {
                    "X-Api-Key": config.lnbitsPayoutAdminKey,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            },
        );
        console.log(` -> Successfully deleted LNURL Link ID: ${linkId}`); // CORRECT Backticks
        return true; // Indicate success
    } catch (deleteError) {
        // Log error but don't necessarily block new link creation if deletion fails
        // LNbits might return 404 if already claimed/deleted, which is acceptable here.
        console.error(
            ` -> Failed/Unable to delete LNURL Link ID ${linkId} (may already be used/gone):`, // CORRECT Backticks
            deleteError.response?.status,
            deleteError.response?.data || deleteError.message,
        );
        return false; // Indicate deletion failed or link wasn't found
    }
}

// Helper function to attempt Internal Transfer
async function attemptInternalTransfer(config, amount, memo) {
    let internalInvoice = null;
    try {
        // Step 1: Create internal invoice on PAYOUT wallet
        const invoicePayload = {
            out: false,
            amount: amount,
            memo: memo,
            webhook: "",
        };
        const invResponse = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`, // CORRECT Backticks
            invoicePayload,
            {
                headers: {
                    "X-Api-Key": config.lnbitsPayoutAdminKey, // Use PAYOUT key
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            },
        );
        if (!invResponse.data?.payment_request) {
            throw new Error(
                "LNbits did not return payment_request for internal invoice.",
            );
        }
        internalInvoice = invResponse.data.payment_request;
        console.log(` -> Internal invoice created for ${amount} sats.`); // CORRECT Backticks
    } catch (invError) {
        console.error(
            "Internal invoice creation failed:",
            invError.response?.data || invError.message,
        );
        throw new Error(
            `Internal invoice failed: ${invError.response?.data?.detail || invError.message}`, // CORRECT Backticks
        );
    }
    try {
        // Step 2: Pay internal invoice from MAIN wallet
        const paymentPayload = { out: true, bolt11: internalInvoice };
        const paymentResponse = await axios.post(
            `${config.lnbitsUrl}/api/v1/payments`, // CORRECT Backticks
            paymentPayload,
            {
                headers: {
                    "X-Api-Key": config.lnbitsMainAdminKey, // Use MAIN funding key
                    "Content-Type": "application/json",
                },
                timeout: 45000, // Longer timeout for payment
            },
        );
        if (!paymentResponse.data?.payment_hash) {
            // Check specific detail for insufficient funds
            if (
                paymentResponse.data?.detail
                    ?.toLowerCase()
                    .includes("insufficient balance")
            ) {
                throw new Error(
                    "Operator Main Wallet has insufficient funds for transfer.",
                );
            }
            throw new Error(
                paymentResponse.data?.detail ||
                    "Internal payment failed (no payment_hash).",
            );
        }
        console.log(
            ` -> Internal transfer successful. Payment Hash: ${paymentResponse.data.payment_hash.substring(0, 10)}...`, // CORRECT Backticks
        );
        return true;
    } catch (paymentError) {
        console.error(
            "Internal payment failed:",
            paymentError.response?.data || paymentError.message,
        );
        // Re-throw specific insufficient funds error if caught earlier
        if (paymentError.message?.includes("insufficient funds")) {
            throw paymentError;
        }
        throw new Error(
            `Internal payment failed: ${paymentError.response?.data?.detail || paymentError.message}`, // CORRECT Backticks
        );
    }
}

// Factory function for the router
const createWithdrawalRouter = (db, config) => {
    const router = express.Router();

    // --- Scoped DB Helpers (Needed for Active Link Tracking) ---
    const getActiveLinkKey = (sessionId) => `active_lnurl_${sessionId}`;

    async function getUserBalance(sessionId) {
        if (!sessionId) return 0;
        const b = await db.get(`balance_${sessionId}`);
        return Math.max(0, parseInt(b || 0));
    }

    async function updateUserBalance(sessionId, amountToAdd) {
        if (!sessionId || isNaN(amountToAdd)) return 0;
        const currentBalance = await getUserBalance(sessionId);
        const newBalance = Math.max(
            0,
            currentBalance + Math.floor(amountToAdd),
        );
        await db.set(`balance_${sessionId}`, newBalance);
        console.log(
            ` -> Session ${sessionId.substring(0, 6)} balance update (claim): ${currentBalance} + ${Math.floor(amountToAdd)} = ${newBalance}`,
        );
        return newBalance;
    }
    // Removed scoped resetUserBalance as balance is updated by amount

    // --- Route: Generate LNURL-Withdraw Link & Fund It (MODIFIED) ---
    router.post("/generate-withdraw-lnurl", async (req, res) => {
        const { sessionId, amount } = req.body;
        let newGeneratedLinkId = null; // Store the ID of the link we might generate
        const activeLinkKey = getActiveLinkKey(sessionId);

        if (!sessionId)
            return res.status(400).json({ error: "Session ID required." });

        if (
            !config.lnbitsUrl ||
            !config.lnbitsPayoutAdminKey ||
            !config.lnbitsMainAdminKey
        ) {
            console.error(
                "/generate-withdraw-lnurl error: Missing required keys.",
            );
            return res
                .status(500)
                .json({ error: "Withdrawal service misconfigured." });
        }

        console.log(
            `Request received: /generate-withdraw-lnurl for session ${sessionId.substring(0, 6)}... Requested Amount: ${amount}`,
        );

        // Main try block for the entire operation
        try {
            const existingLinkId = await db.get(activeLinkKey); // <<<<< ***** existingLinkId is fetched here *****

            if (existingLinkId) { // <<<<< ***** Check if existingLinkId actually exists *****
                console.log(
                    ` -> Found existing active link ID: ${existingLinkId} for session ${sessionId.substring(0, 6)}. Attempting server-side check & deletion...`,
                );

                // ---- START OF FIX: SERVER-SIDE CHECK OF PREVIOUS LINK (CORRECTED PLACEMENT) ----
                try {
                    const host = req.get('host');
                    const protocol = req.protocol;
                    // ***** CRITICAL: Use the 'existingLinkId' variable that was fetched above *****
                    const internalCheckUrl = `${protocol}://${host}/api/check-lnurl-claim/${existingLinkId}/${sessionId}`;

                    console.log(` -> Internally checking claim status of ${existingLinkId} via GET ${internalCheckUrl}`);
                    const internalResponse = await axios.get(internalCheckUrl, { timeout: 7000 });

                    if (internalResponse.data && internalResponse.data.claimed === true) {
                        console.log(` -> Server-side check: Previous link ${existingLinkId} was claimed. Balance (should have been) updated by the check call.`);
                    } else {
                        console.log(` -> Server-side check: Previous link ${existingLinkId} not claimed or status unknown (HTTP ${internalResponse.status}).`);
                    }
                } catch (internalCheckError) {
                    if (internalCheckError.response) {
                        console.warn(` -> Warning during internal server-side check of ${existingLinkId}: Status ${internalCheckError.response.status}`, internalCheckError.response.data);
                    } else {
                        console.warn(` -> Warning during internal server-side check of ${existingLinkId}:`, internalCheckError.message);
                    }
                }
                // ---- END OF FIX ----

                // --- Now, proceed with the original logic for deleting the existing link ---
                const deleted = await attemptLnbitsDeleteWithdrawLink(
                    config,
                    existingLinkId,
                );
                if (deleted) {
                    console.log(
                        ` -> Deletion of ${existingLinkId} successful (or link was already gone).`,
                    );
                } else {
                    console.warn(
                        ` -> Deletion of ${existingLinkId} failed, proceeding with caution.`,
                    );
                }
                // Always clear the key from DB after attempting deletion and check
                await db.delete(activeLinkKey);
                console.log(
                    ` -> Cleared active link key for session ${sessionId.substring(0, 6)} after check and deletion attempt.`,
                );

            } else { // This 'else' corresponds to 'if (existingLinkId)'
                console.log(
                    ` -> No existing active link found for session ${sessionId.substring(0, 6)}.`,
                );
            }

            // Fetch balance *after* the potential update from the internal check and deletion of old link
            const balance = await getUserBalance(sessionId);
            console.log(` -> Current balance after checks: ${balance} sats for session ${sessionId.substring(0,6)}`);

            if (balance <= 0) {
                return res.status(400).json({
                    error: "Insufficient balance.",
                    details: "Balance is zero or negative.",
                });
            }

            // ... (rest of your logic for determining amountToWithdraw, generating new link, funding it, etc.)
            // This part seems fine from your previous snippet:
            let amountToWithdraw = balance;
            if (
                amount !== null &&
                typeof amount !== "undefined" &&
                amount !== ""
            ) {
                const requestedAmount = parseInt(amount);
                console.log(` -> Parsed requested amount: ${requestedAmount}`);
                if (!isNaN(requestedAmount) && requestedAmount > 0) {
                    if (requestedAmount <= balance) {
                        amountToWithdraw = requestedAmount;
                        console.log(
                            ` -> Valid partial withdrawal requested: ${amountToWithdraw} sats`,
                        );
                    } else {
                        console.warn(
                            ` -> Requested amount (${requestedAmount}) exceeds balance (${balance}).`,
                        );
                        return res.status(400).json({
                            error: "Insufficient balance.",
                            details: `Requested ${requestedAmount} sats, but only ${balance} available.`,
                        });
                    }
                } else {
                    console.warn(
                        ` -> Invalid amount requested (${amount}). Defaulting to full balance.`,
                    );
                }
            } else {
                console.log(
                    ` -> No specific amount requested. Withdrawing full balance: ${amountToWithdraw} sats`,
                );
            }

            if (amountToWithdraw <= 0) {
                console.error(
                    ` -> Calculated amountToWithdraw is zero or less (${amountToWithdraw}), cannot proceed.`,
                );
                return res.status(400).json({
                    error: "Invalid amount.",
                    details: "Withdrawal amount must be positive.",
                });
            }

            // 1. Generate NEW LNURL Link
            console.log(
                ` -> 1. Generating NEW LNURL Link for ${amountToWithdraw} sats...`,
            );
            const withdrawPayload = {
                title:
                    config.LNURL_WITHDRAW_TITLE ||
                    `Withdraw ${amountToWithdraw} sats`,
                min_withdrawable: amountToWithdraw,
                max_withdrawable: amountToWithdraw,
                uses: 1,
                wait_time: 1,
                is_unique: true,
            };
            const linkData = await attemptLnbitsWithdrawLink(
                config,
                withdrawPayload,
            );
            newGeneratedLinkId = linkData.id;
            const lnurlString = linkData.lnurl;
            console.log(
                ` -> NEW Link generated successfully. ID: ${newGeneratedLinkId}`,
            );

            // 2. Attempt Internal Transfer for the NEW link
            const transferAmount =
                amountToWithdraw +
                Math.max(2, Math.ceil(amountToWithdraw * 0.02));
            const transferMemo = `Funding LNURL ${newGeneratedLinkId} for session ${sessionId.substring(0, 6)} (${amountToWithdraw} sats)`;
            console.log(
                ` -> 2. Attempting internal transfer of ${transferAmount} sats for NEW link...`,
            );
            await attemptInternalTransfer(config, transferAmount, transferMemo);
            console.log(
                ` -> Funding successful for NEW Link ID ${newGeneratedLinkId}`,
            );

            // 3. Store the NEW active link ID in DB *only after successful funding*
            await db.set(activeLinkKey, newGeneratedLinkId);
            console.log(
                ` -> Stored NEW active link ID ${newGeneratedLinkId} for session ${sessionId.substring(0, 6)}.`,
            );

            // 4. Return NEW LNURL and Link ID to frontend
            res.json({
                lnurl: lnurlString,
                link_id: newGeneratedLinkId,
                withdrawn_amount: amountToWithdraw,
            });

        // Catch block for the main operation
        } catch (error) {
            console.error(
                `--- ERROR during LNURL generation/funding for session ${sessionId.substring(0, 6)} ---`,
            );
            console.error("Error details:", error.message);

            if (newGeneratedLinkId) {
                console.log(
                    "Operation failed after new link generation. Attempting to delete the new link...",
                );
                await attemptLnbitsDeleteWithdrawLink(
                    config,
                    newGeneratedLinkId,
                );
            }
            await db
                .delete(activeLinkKey)
                .catch((e) =>
                    console.error(
                        "Failed to clear active link key on error:",
                        e,
                    ),
                );

            if (!res.headersSent) {
                let userErrorMessage = "Failed to prepare withdrawal.";
                let userErrorDetails = error.message || "Unknown error";
                let statusCode = 500;

                if (
                    error.message?.includes(
                        "Operator Main Wallet has insufficient funds",
                    )
                ) {
                    userErrorMessage = "Withdrawal Temporarily Unavailable";
                    userErrorDetails =
                        "Operator funding low. Please try again later.";
                    statusCode = 503;
                    console.warn(
                        "!!! Operator funding wallet low, returning user-friendly error !!!",
                    );
                } else if (
                    error.message?.includes("Insufficient balance") &&
                    error.message?.includes("Requested")
                ) {
                    userErrorMessage = "Insufficient balance.";
                    userErrorDetails = error.message;
                    statusCode = 400;
                }

                res.status(statusCode).json({
                    error: userErrorMessage,
                    details: userErrorDetails,
                });
            }
        }
    });

    // --- Route: Check LNURL-Withdraw Link Claim Status (MODIFIED) ---
    router.get("/check-lnurl-claim/:link_id/:sessionId", async (req, res) => {
        const { link_id, sessionId } = req.params;
        const activeLinkKey = getActiveLinkKey(sessionId); // Key for storing active link ID

        if (!link_id || !sessionId) {
            return res
                .status(400)
                .json({ error: "Link ID and Session ID required." });
        }
        if (!config.lnbitsUrl || !config.lnbitsPayoutAdminKey) {
            console.error("/check-lnurl-claim error: Missing payout config.");
            return res
                .status(503)
                .json({ error: "Check service misconfigured." });
        }

        const checkUrl = `${config.lnbitsUrl}/withdraw/api/v1/links/${link_id}`; // Corrected URL
        try {
            const response = await axios.get(checkUrl, {
                headers: {
                    "X-Api-Key": config.lnbitsPayoutAdminKey,
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            });
            const linkData = response.data;

            if (linkData && linkData.used >= 1) {
                const claimedAmount = linkData.max_withdrawable;
                console.log(
                    ` -> LNURL Link ${link_id} confirmed USED for ${claimedAmount} sats by session ${sessionId.substring(0, 6)}. Deducting balance.`,
                );

                    if (typeof claimedAmount === "number" && claimedAmount > 0) {
                        // Before updating balance, check if this specific link_id has already been processed for deduction
                        const processedKey = `processed_claim_${link_id}`;
                        if (await db.get(processedKey)) {
                            console.log(` -> Link ${link_id} already processed for balance deduction. Skipping.`);
                        } else {
                            await updateUserBalance(sessionId, -claimedAmount); // Deduct balance
                            await db.set(processedKey, true); // Mark as processed
                            // Consider setting an expiry for this key if needed, e.g., db.set(processedKey, true, {EX: 3600});
                        }
                    // --- START: Clear Active Link ID on Claim ---
                    const storedActiveLink = await db.get(activeLinkKey);
                    if (storedActiveLink === link_id) {
                        await db.delete(activeLinkKey);
                        console.log(
                            ` -> Cleared active link key ${activeLinkKey} after successful claim.`,
                        );
                    } else if (storedActiveLink) {
                        console.warn(
                            ` -> Claimed link ${link_id} did not match stored active link ${storedActiveLink}. Stored link not cleared automatically.`,
                        );
                    }
                    // --- END: Clear Active Link ID on Claim ---
                } else {
                    console.error(
                        ` !! Could not determine claimed amount from link data for link ${link_id}. Balance NOT updated.`,
                    );
                }
                res.json({ claimed: true, amount: claimedAmount });
            } else if (linkData) {
                res.json({ claimed: false }); // Found but not used
            } else {
                console.warn(
                    ` -> Invalid link data or link not found for LNURL Link ${link_id}:`,
                    linkData,
                );
                res.status(404).json({
                    claimed: false,
                    error: "Withdraw link not found/invalid.",
                });
            }
        } catch (error) {
            console.error(
                `Error checking LNURL link ${link_id}:`,
                error.response
                    ? `LNbits Status ${error.response.status} Data: ${JSON.stringify(error.response.data)}`
                    : error.message || error,
            );
            // Handle 404 specifically as "not found" / not claimed yet potentially
            if (error.response && error.response.status === 404) {
                console.log(
                    ` -> Check returned 404 for link ${link_id} (Likely not claimed yet or expired/deleted).`,
                );
                res.json({
                    claimed: false,
                    error: "Link not found or not claimed.",
                });
            } else {
                res.status(503).json({
                    claimed: false,
                    error: "Failed to check withdrawal status with LNbits.",
                });
            }
        }
    });

    return router;
};

module.exports = createWithdrawalRouter;
// --- END OF FILE backend/withdrawalRoutes.js ---
