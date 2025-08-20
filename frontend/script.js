// --- START OF FILE frontend/script.js ---
// [FINAL CLEANED VERSION - 2025-04-16c]
document.addEventListener("DOMContentLoaded", () => {
    // --- DOM Elements ---
    const updateWithdrawLinkButton = document.getElementById(
        "update-withdraw-link-button",
    );
    const drawButton = document.getElementById("draw-button");
    const cardDisplay = document.getElementById("card-display");
    const fortuneDisplay = document.getElementById("fortune-display");
    const jackpotInfo = document.getElementById("jackpot-info");
    const balanceInfo = document.getElementById("balance-info");
    const infoTrigger = document.getElementById("info-trigger");
    const instructionsArea = document.getElementById("instructions-area");
    const withdrawButton = document.getElementById("withdraw-button");
    const paymentModal = document.getElementById("payment-modal");
    const modalCloseButton = document.getElementById("modal-close-button");
    const qrcodeContainer = document.getElementById("qrcode-container");
    const paymentStatus = document.getElementById("payment-status");
    const invoiceTextElement = document.getElementById("invoice-text");
    const withdrawModal = document.getElementById("withdraw-modal");
    const withdrawModalCloseButton = document.getElementById(
        "withdraw-modal-close-button",
    );
    const withdrawAmountDisplay = document.getElementById(
        "withdraw-amount-display",
    );
    const withdrawAmountInputField = document.getElementById(
        "withdraw-amount-input-field",
    );
    const withdrawStatus = document.getElementById("withdraw-status");
    const withdrawQrcodeContainer = document.getElementById(
        "withdraw-qrcode-container",
    );
    const withdrawLnurlText = document.getElementById("withdraw-lnurl-text");
    const keyWinsDisplay = document.getElementById("key-wins-display");
    const depositButton = document.getElementById("deposit-button"); // New
    const depositModal = document.getElementById("deposit-modal"); // New
    const depositModalCloseButton = document.getElementById(
        "deposit-modal-close-button",
    ); // New
    const depositAmountInputField = document.getElementById(
        "deposit-amount-input-field",
    ); // New
    const generateDepositInvoiceButton = document.getElementById(
        "generate-deposit-invoice-button",
    ); // New
    const depositStatus = document.getElementById("deposit-status"); // New
    const depositQrcodeContainer = document.getElementById(
        "deposit-qrcode-container",
    ); // New
    const depositInvoiceText = document.getElementById("deposit-invoice-text"); // New

    // --- Constants ---
    const SESSION_URL = "/api/session";
    const BALANCE_URL_BASE = "/api/balance/";
    const CREATE_INVOICE_URL = "/api/create-invoice";
    const CHECK_INVOICE_URL_BASE = "/api/check-invoice/";
    const DRAW_CARDS_URL = "/api/draw";
    const DRAW_FROM_BALANCE_URL = "/api/draw-from-balance";
    const GENERATE_LNURL_URL = "/api/generate-withdraw-lnurl";
    const CHECK_LNURL_CLAIM_URL_BASE = "/api/check-lnurl-claim/";
    const POLLING_INTERVAL_MS = 3000;
    const POLLING_TIMEOUT_MS = 300000;
    const LNURL_POLLING_INTERVAL_MS = 5000;
    const LNURL_POLLING_TIMEOUT_MS = 300000;
    const WS_RECONNECT_DELAY = 5000;
    const PLAY_COST = 21;
    const CREATE_DEPOSIT_INVOICE_URL = "/api/create-deposit-invoice"; // New

    // --- State ---
    let currentWithdrawableBalance = 0;
    let sessionId = localStorage.getItem("madameSatoshiSessionId") || null;
    let invoicePollingIntervalId = null;
    let paymentHash = null;
    let invoicePollingTimeoutId = null;
    let lnurlClaimPollingIntervalId = null;
    let lnurlClaimPollingTimeoutId = null;
    let currentInvoiceString = "";
    let currentLnurlString = "";
    let currentLnurlLinkId = null;
    let socket = null;
    let wsReconnectTimeout = null;
    let originalPaymentStatusInfo = { text: "", className: "", color: "" };
    let currentDepositInvoice = ""; // New
    let currentDepositHash = null; // New

    // --- Helper Functions ---
    function resetButtonState(enabled, text = null) {
        if (!drawButton) return;
        drawButton.disabled = !enabled;
        if (text !== null) {
            drawButton.textContent = text;
        }
    }
    function createSingleCard(cardData) {
        const el = document.createElement("div");
        el.classList.add("card");
        const img = document.createElement("img");
        img.src = `cards/${cardData.image}`;
        img.alt = cardData.name;
        img.title = cardData.name;
        el.appendChild(img);
        return el;
    }
    function displayError(
        message,
        isPaymentModalError = false,
        isWithdrawModalError = false,
    ) {
        console.error(
            `Error Display: ${message}`,
            isPaymentModalError
                ? "(Payment Modal)"
                : isWithdrawModalError
                  ? "(Withdraw Modal)"
                  : "(Main Display)",
        );
        let targetDisplay;
        let color = "#ff6b6b";
        if (isPaymentModalError && paymentStatus) {
            targetDisplay = paymentStatus;
            targetDisplay.className = "error";
        } else if (isWithdrawModalError && withdrawStatus) {
            targetDisplay = withdrawStatus;
            targetDisplay.className = "error";
        } else if (fortuneDisplay) {
            targetDisplay = fortuneDisplay;
            targetDisplay.classList.remove(
                "fortune-visible",
                "showing-invoice",
                "clickable-invoice",
                "copy-success",
                "fortune-win",
            );
            targetDisplay.style.opacity = "1";
            targetDisplay.style.cursor = "default";
            targetDisplay.title = "";
            targetDisplay.style.color = "";
            if (cardDisplay) cardDisplay.innerHTML = "";
            if (keyWinsDisplay) keyWinsDisplay.style.display = "block";
        } else {
            console.error("Cannot find target element for error display.");
            return;
        }
        targetDisplay.textContent = `Error: ${message}`;
        targetDisplay.style.color = color;
    }
    function resetFortuneDisplay(message = "Madame Satoshi awaits...") {
        if (!fortuneDisplay || !cardDisplay) {
            return;
        }
        fortuneDisplay.classList.remove(
            "showing-invoice",
            "fortune-visible",
            "clickable-invoice",
            "copy-success",
            "fortune-win",
        );
        fortuneDisplay.style.opacity = "1";
        fortuneDisplay.style.color = "";
        fortuneDisplay.style.cursor = "default";
        fortuneDisplay.title = "";
        fortuneDisplay.textContent = message;
        cardDisplay.innerHTML = "";
        currentInvoiceString = "";
        if (keyWinsDisplay) keyWinsDisplay.style.display = "block";
    }
    function showPaymentModal(invoice, pHashToShow) {
        if (
            !paymentModal ||
            !qrcodeContainer ||
            !paymentStatus ||
            !modalCloseButton ||
            !invoiceTextElement
        ) {
            console.error("Missing payment modal elements.");
            return;
        }
        currentInvoiceString = invoice;
        qrcodeContainer.innerHTML = '<canvas id="qrcode-canvas"></canvas>';
        qrcodeContainer.classList.remove("copy-success-qr");
        if (invoiceTextElement) {
            invoiceTextElement.textContent = invoice;
            invoiceTextElement.classList.add("clickable-invoice");
            invoiceTextElement.classList.remove("copy-success");
        }
        const canvas = document.getElementById("qrcode-canvas");
        if (!canvas || typeof QRCode === "undefined") {
            displayError("Cannot display QR code.", true);
            return;
        }
        try {
            const qrSize = Math.min(qrcodeContainer.offsetWidth * 0.85, 240);
            QRCode.toCanvas(
                canvas,
                invoice.toUpperCase(),
                { width: qrSize, margin: 1, errorCorrectionLevel: "L" },
                function (error) {
                    if (error) {
                        console.error("QR generation error:", error);
                        displayError("Could not generate QR code.", true);
                    }
                },
            );
        } catch (qrError) {
            console.error("QR Canvas exception:", qrError);
            displayError("QR generation failed.", true);
        }
        originalPaymentStatusInfo = {
            text: "Waiting for payment...",
            className: "",
            color: "#ffcc66",
        };
        paymentStatus.textContent = originalPaymentStatusInfo.text;
        paymentStatus.className = originalPaymentStatusInfo.className;
        paymentStatus.style.color = originalPaymentStatusInfo.color;
        paymentModal.style.display = "flex";
        setTimeout(() => paymentModal.classList.add("is-visible"), 10);
    }
    function hidePaymentModal(reason = "unknown") {
        if (!paymentModal) return;
        paymentModal.classList.remove("is-visible");
        if (paymentModal.hidingTimeoutId) {
            return;
        }
        paymentModal.hidingTimeoutId = setTimeout(() => {
            paymentModal.style.display = "none";
            const isSuccessClosure = reason.startsWith("paymentSuccess");
            if (!isSuccessClosure) {
                stopInvoicePolling(false, `hidePaymentModal via ${reason}`);
                if (!paymentHash) {
                    resetFortuneDisplay("Payment cancelled.");
                    if (sessionId) {
                        updateBalanceDisplay(currentWithdrawableBalance);
                        resetButtonState(true);
                    }
                }
            }
            paymentModal.hidingTimeoutId = null;
        }, 400);
    }
    function showDepositModal() {
        if (
            !depositModal ||
            !depositAmountInputField ||
            !depositStatus ||
            !depositQrcodeContainer ||
            !depositInvoiceText
        ) {
            console.error("Deposit modal elements missing!");
            return;
        }
        // Reset state
        depositAmountInputField.value = "";
        depositStatus.textContent = "Enter amount and generate invoice.";
        depositStatus.className = "";
        depositStatus.style.color = "#ffcc66";
        depositQrcodeContainer.style.display = "none";
        depositQrcodeContainer.innerHTML =
            '<canvas id="deposit-qrcode-canvas"></canvas>'; // Reset canvas container
        depositInvoiceText.style.display = "none";
        depositInvoiceText.textContent = "";
        depositInvoiceText.classList.remove(
            "clickable-invoice",
            "copy-success",
        ); // Ensure class reset
        currentDepositInvoice = "";
        currentDepositHash = null;
        // Display
        depositModal.style.display = "flex";
        setTimeout(() => depositModal.classList.add("is-visible"), 10);
    }

    function hideDepositModal(reason = "unknown") {
        if (!depositModal) return;
        // Optional: Stop any polling related to deposit if implemented later
        depositModal.classList.remove("is-visible");
        setTimeout(() => {
            depositModal.style.display = "none";
            currentDepositInvoice = ""; // Clear state on close
            currentDepositHash = null;
        }, 400);
    }
    function showWithdrawModal() {
        if (
            !withdrawModal ||
            !withdrawStatus ||
            !withdrawLnurlText ||
            !withdrawQrcodeContainer ||
            !withdrawModalCloseButton ||
            !withdrawAmountDisplay ||
            !withdrawAmountInputField
        ) {
            console.error("Withdraw modal elements missing!");
            return;
        }
        currentLnurlString = "";
        currentLnurlLinkId = null;
        stopLnurlClaimPolling("Opening new modal");
        withdrawStatus.textContent = "Generating withdrawal link...";
        withdrawStatus.className = "";
        withdrawStatus.style.color = "#ffcc66";
        withdrawLnurlText.textContent = "";
        withdrawLnurlText.classList.remove("clickable-lnurl", "copy-success");
        withdrawQrcodeContainer.innerHTML =
            '<canvas id="withdraw-qrcode-canvas"></canvas>';
        withdrawQrcodeContainer.classList.remove("copy-success-qr");
        withdrawAmountDisplay.textContent = `Current Balance: ${currentWithdrawableBalance} sats`;
        withdrawAmountInputField.value = "";
        withdrawModal.style.display = "flex";
        setTimeout(() => withdrawModal.classList.add("is-visible"), 10);
        generateLnurlWithdraw();
    }
    function hideWithdrawModal(reason = "unknown") {
        if (!withdrawModal) return;
        stopLnurlClaimPolling(`Modal closed (${reason})`);
        withdrawModal.classList.remove("is-visible");
        setTimeout(() => {
            withdrawModal.style.display = "none";
            currentLnurlString = "";
            currentLnurlLinkId = null;
        }, 400);
    }
    function updateJackpotDisplay(poolAmount) {
        if (!jackpotInfo) {
            return;
        }
        if (typeof poolAmount === "number" && !isNaN(poolAmount)) {
            jackpotInfo.textContent = `Jackpot Pool: ${poolAmount} sats`;
            jackpotInfo.classList.remove("flash-update");
            void jackpotInfo.offsetWidth;
            jackpotInfo.classList.add("flash-update");
            setTimeout(() => {
                jackpotInfo.classList.remove("flash-update");
            }, 800);
        } else {
            jackpotInfo.textContent = `Jackpot Pool: ??? sats`;
        }
    }
    function updateBalanceDisplay(balanceAmount) {
        if (!balanceInfo || !withdrawButton || !drawButton) {
            return;
        }
        if (typeof balanceAmount === "number" && !isNaN(balanceAmount)) {
            const oldBalance = currentWithdrawableBalance;
            currentWithdrawableBalance = Math.max(0, Math.floor(balanceAmount));
            balanceInfo.textContent = `Balance: ${currentWithdrawableBalance} sats`;
            withdrawButton.disabled = currentWithdrawableBalance <= 0;
            if (
                drawButton.textContent !== "Initializing..." &&
                drawButton.textContent !== "Session Error"
            ) {
                const canAfford = currentWithdrawableBalance >= PLAY_COST;
                if (canAfford) {
                    drawButton.textContent = `Play (Use ${PLAY_COST} Sats Balance)`;
                } else {
                    drawButton.textContent = `Play (Pay ${PLAY_COST} Sats)`;
                }
            }
            if (currentWithdrawableBalance > oldBalance && balanceInfo) {
                balanceInfo.classList.add("flash-success");
                setTimeout(() => {
                    balanceInfo.classList.remove("flash-success");
                }, 700);
            }
        } else {
            balanceInfo.textContent = `Balance: ??? sats`;
            withdrawButton.disabled = true;
        }
    }
    function stopInvoicePolling(isSuccess = false, reason = "unknown") {
        if (invoicePollingIntervalId) {
            clearInterval(invoicePollingIntervalId);
            invoicePollingIntervalId = null;
        }
        if (invoicePollingTimeoutId) {
            clearTimeout(invoicePollingTimeoutId);
            invoicePollingTimeoutId = null;
        }
        if (!isSuccess) {
            paymentHash = null;
            currentInvoiceString = "";
        }
    }
    function startInvoicePolling() {
        if (!paymentHash || paymentHash.length !== 64) {
            displayError(
                "Cannot poll invoice: Invalid payment reference.",
                true,
            );
            if (sessionId) updateBalanceDisplay(currentWithdrawableBalance);
            return;
        }
        const pollingForHash = paymentHash;
        console.log(
            `Starting INVOICE polling for hash: ${pollingForHash.substring(0, 10)}...`,
        );
        stopInvoicePolling("Starting new poll");
        stopLnurlClaimPolling("Starting invoice poll");
        invoicePollingIntervalId = setInterval(async () => {
            if (!invoicePollingIntervalId || paymentHash !== pollingForHash) {
                if (invoicePollingIntervalId)
                    clearInterval(invoicePollingIntervalId);
                invoicePollingIntervalId = null;
                return;
            }
            try {
                const checkUrl = CHECK_INVOICE_URL_BASE + pollingForHash;
                const response = await fetch(checkUrl);
                if (!invoicePollingIntervalId) {
                    return;
                }
                if (!response.ok) {
                    return;
                }
                const data = await response.json();
                if (data && data.paid === true) {
                    const confirmedHash = pollingForHash;
                    console.log(
                        `Invoice Payment confirmed: ${confirmedHash.substring(0, 10)}!`,
                    );
                    if (invoicePollingIntervalId) {
                        clearInterval(invoicePollingIntervalId);
                        invoicePollingIntervalId = null;
                    }
                    stopInvoicePolling(
                        true,
                        `paymentSuccess(${confirmedHash.substring(0, 10)})`,
                    );
                    if (paymentStatus) {
                        // For the play modal
                        paymentStatus.textContent = "Payment Confirmed!";
                        paymentStatus.className = "paid";
                    }
                    setTimeout(() => {
                        // Hides modal after 0.8s
                        if (paymentModal?.classList.contains("is-visible")) {
                            // CORRECTED LINE:
                            hidePaymentModal(
                                `paymentSuccess(${confirmedHash.substring(0, 10)})`,
                            );
                        }
                    }, 800);
                    setTimeout(() => {
                        // Calls performCardDraw after 0.9s
                        performCardDraw(confirmedHash);
                    }, 900);
                    return;
                }
            } catch (error) {
                console.error(`Invoice polling fetch error:`, error);
            }
        }, POLLING_INTERVAL_MS);
        invoicePollingTimeoutId = setTimeout(() => {
            if (paymentHash === pollingForHash && invoicePollingIntervalId) {
                console.warn(
                    "Invoice polling timed out:",
                    pollingForHash.substring(0, 10),
                );
                stopInvoicePolling(
                    false,
                    `timeout(${pollingForHash.substring(0, 10)})`,
                );
                if (paymentModal?.classList.contains("is-visible")) {
                    hidePaymentModal(
                        `timeout(${pollingForHash.substring(0, 10)})`,
                    );
                    setTimeout(() => {
                        displayError("Payment timed out.", false);
                        if (sessionId)
                            updateBalanceDisplay(currentWithdrawableBalance);
                    }, 450);
                } else {
                    if (sessionId)
                        updateBalanceDisplay(currentWithdrawableBalance);
                }
            }
            invoicePollingTimeoutId = null;
        }, POLLING_TIMEOUT_MS);
    }
    function startDepositInvoicePolling(depositHash, depositAmount) {
        if (!depositHash || depositHash.length !== 64 || !sessionId) {
            console.error(
                "Cannot poll deposit invoice: Invalid hash or session.",
            );
            // Optionally update depositStatus with an error
            return;
        }
        const pollingForDepositHash = depositHash;
        console.log(
            `Starting DEPOSIT INVOICE polling for hash: ${pollingForDepositHash.substring(0, 10)}... Amount: ${depositAmount}`,
        );

        // Stop other polling if running
        stopInvoicePolling("Starting deposit poll");
        stopLnurlClaimPolling("Starting deposit poll");
        // Clear any previous deposit polling timers
        // (Need corresponding stop function if making this robust against multiple clicks)
        // stopDepositInvoicePolling("Starting new poll");

        const depositPollingIntervalId = setInterval(async () => {
            // Add check if still polling this hash/modal is open?
            try {
                const checkUrl = `/api/check-deposit-invoice/${pollingForDepositHash}`; // Use NEW endpoint
                const response = await fetch(checkUrl);

                if (!response.ok) {
                    // Don't stop polling on transient errors, but log them
                    console.warn(
                        `Deposit poll check failed: HTTP ${response.status}. Continuing.`,
                    );
                    return;
                }
                const data = await response.json();

                if (data && data.paid === true) {
                    console.log(
                        `Deposit Invoice Payment confirmed: ${pollingForDepositHash.substring(0, 10)}!`,
                    );
                    clearInterval(depositPollingIntervalId); // Stop polling THIS interval

                    if (
                        depositStatus &&
                        depositModal?.classList.contains("is-visible")
                    ) {
                        depositStatus.textContent = "✔️ Payment Received!";
                        // ...
                    }
                    await notifyDepositSuccess(
                        sessionId,
                        pollingForDepositHash,
                        depositAmount,
                    );
                    setTimeout(() => {
                        // Hides modal after 1.5s
                        if (depositModal?.classList.contains("is-visible")) {
                            hideDepositModal("depositPaid");
                        }
                    }, 1500);
                    return;
                }
                // else: Invoice not paid yet, continue polling
            } catch (error) {
                console.error(`Deposit invoice polling fetch error:`, error);
                // Decide if error is fatal (stop polling) or transient (continue)
            }
        }, POLLING_INTERVAL_MS); // Use existing interval constant

        // Optional: Add a timeout similar to invoicePollingTimeoutId
        // const depositPollingTimeoutId = setTimeout(() => { ... stop polling ... }, POLLING_TIMEOUT_MS);
    }
    function stopLnurlClaimPolling(reason = "unknown") {
        if (lnurlClaimPollingIntervalId || lnurlClaimPollingTimeoutId) {
            console.log(`Stopping LNURL claim polling. Reason: ${reason}`);
            if (lnurlClaimPollingIntervalId) {
                clearInterval(lnurlClaimPollingIntervalId);
                lnurlClaimPollingIntervalId = null;
            }
            if (lnurlClaimPollingTimeoutId) {
                clearTimeout(lnurlClaimPollingTimeoutId);
                lnurlClaimPollingTimeoutId = null;
            }
        }
    }
    function startLnurlClaimPolling(linkId, userSessionId, expectedAmount) {
        if (!linkId || !userSessionId) {
            console.error("Cannot start LNURL poll: Missing linkId/sessionId.");
            if (withdrawStatus) {
                withdrawStatus.textContent = "Error: Internal polling error.";
                withdrawStatus.className = "error";
            }
            return;
        }
        stopLnurlClaimPolling("Starting new poll");
        stopInvoicePolling("Starting LNURL poll");
        currentLnurlLinkId = linkId;
        console.log(
            `Starting LNURL poll for Link ID: ${linkId.substring(0, 8)}... Session: ${userSessionId.substring(0, 6)}... Expected: ${expectedAmount}`,
        );
        if (withdrawStatus) {
            withdrawStatus.textContent = `Waiting for you to claim ${expectedAmount} sats...`;
            withdrawStatus.className = "";
            withdrawStatus.style.color = "#ffcc66";
        }
        lnurlClaimPollingIntervalId = setInterval(async () => {
            if (
                !lnurlClaimPollingIntervalId ||
                currentLnurlLinkId !== linkId ||
                sessionId !== userSessionId
            ) {
                if (lnurlClaimPollingIntervalId)
                    clearInterval(lnurlClaimPollingIntervalId);
                lnurlClaimPollingIntervalId = null;
                return;
            }
            try {
                const url = `${CHECK_LNURL_CLAIM_URL_BASE}${linkId}/${userSessionId}`;
                /* console.log(`LNURL Polling: Fetching ${url}`); */ const response =
                    await fetch(url);
                /* console.log(`LNURL Polling: Status ${response.status} for ${linkId.substring(0,8)}`); */ if (
                    !lnurlClaimPollingIntervalId
                ) {
                    return;
                }
                if (!response.ok) {
                    if (response.status === 404) {
                        console.warn(
                            `LNURL check 404 for ${linkId.substring(0, 8)}. Stopping poll.`,
                        );
                        displayError(
                            `Withdrawal link expired or invalid.`,
                            false,
                            true,
                        );
                        stopLnurlClaimPolling("Link not found");
                    } else {
                        console.warn(
                            `LNURL poll check failed: HTTP ${response.status}. Continuing.`,
                        );
                        if (
                            withdrawStatus &&
                            !withdrawStatus.className.includes("error")
                        )
                            withdrawStatus.textContent = "Checking status...";
                    }
                    return;
                }
                const data = await response.json();
                /* console.log(`LNURL Polling: Data for ${linkId.substring(0,8)}:`, data); */ if (
                    data &&
                    data.claimed === true
                ) {
                    console.log(
                        `LNURL Link ${linkId.substring(0, 8)} confirmed CLAIMED!`,
                    );
                    stopLnurlClaimPolling("Claim success");
                    const amountClaimed = data.amount || expectedAmount;
                    if (withdrawStatus) {
                        withdrawStatus.textContent = `✔️ ${amountClaimed} Sats Claimed Successfully!`;
                        withdrawStatus.className = "paid";
                        withdrawStatus.style.color = "#77cc77";
                    }
                    const balanceBeforeUpdate = currentWithdrawableBalance;
                    const newBalance = Math.max(
                        0,
                        balanceBeforeUpdate - amountClaimed,
                    );
                    updateBalanceDisplay(newBalance);
                    console.log(
                        `Frontend balance updated: ${balanceBeforeUpdate} - ${amountClaimed} = ${currentWithdrawableBalance}`,
                    );
                    setTimeout(() => {
                        if (withdrawModal?.classList.contains("is-visible")) {
                            hideWithdrawModal("claimSuccess");
                        }
                    }, 2500);
                    return;
                } /* console.log(`LNURL Polling: Claimed status is ${data?.claimed}. Continuing.`); */
            } catch (error) {
                console.error(
                    `LNURL poll fetch/JSON error for ${linkId.substring(0, 8)}:`,
                    error,
                );
                if (
                    !(error instanceof SyntaxError) &&
                    withdrawStatus &&
                    !withdrawStatus.className.includes("error")
                ) {
                    withdrawStatus.textContent =
                        "Checking status (network/parse issue?)...";
                } else if (error instanceof SyntaxError) {
                    console.error(
                        "Backend likely still returning non-JSON for LNURL check.",
                    );
                    if (withdrawStatus) {
                        withdrawStatus.textContent = "Status Check Error...";
                        withdrawStatus.className = "error";
                    }
                }
            }
        }, LNURL_POLLING_INTERVAL_MS);
        lnurlClaimPollingTimeoutId = setTimeout(() => {
            if (currentLnurlLinkId === linkId && lnurlClaimPollingIntervalId) {
                console.warn(
                    `LNURL claim polling timed out for ${linkId.substring(0, 8)}`,
                );
                stopLnurlClaimPolling(`timeout(${linkId.substring(0, 8)})`);
                if (withdrawModal?.classList.contains("is-visible")) {
                    displayError(
                        `Claim not detected. Check wallet. Balance NOT reset.`,
                        false,
                        true,
                    );
                }
            }
            lnurlClaimPollingTimeoutId = null;
        }, LNURL_POLLING_TIMEOUT_MS);
    }
    function displayDrawResults(data) {
        try {
            if (
                !data ||
                !Array.isArray(data.cards) ||
                typeof data.fortune !== "string" ||
                data.cards.length !== 3 ||
                typeof data.sats_won_this_round === "undefined" ||
                typeof data.user_balance === "undefined" ||
                typeof data.current_jackpot === "undefined"
            ) {
                throw new Error("Invalid draw data.");
            }
            let cardAnimDur = 0;
            if (cardDisplay) {
                cardDisplay.innerHTML = "";
                data.cards.forEach((c, i) => {
                    const el = createSingleCard(c);
                    cardDisplay.appendChild(el);
                    const d = 50 + i * 200,
                        a = 800;
                    setTimeout(() => el.classList.add("is-visible"), d);
                    cardAnimDur = Math.max(cardAnimDur, d + a);
                });
            }
            let fortuneTxt = data.fortune;
            const isWin =
                data.sats_won_this_round > 0 ||
                fortuneTxt.toLowerCase().includes("jackpot") ||
                fortuneTxt.toLowerCase().includes("win!");
            const fortuneDelay = Math.max(cardAnimDur + 300, 2500);
            setTimeout(() => {
                if (fortuneDisplay) {
                    fortuneDisplay.style.opacity = "0";
                    setTimeout(() => {
                        fortuneDisplay.textContent = fortuneTxt;
                        fortuneDisplay.classList.remove("fortune-win");
                        fortuneDisplay.style.color = "";
                        if (isWin) fortuneDisplay.classList.add("fortune-win");
                        fortuneDisplay.classList.add("fortune-visible");
                        fortuneDisplay.style.opacity = "1";
                    }, 300);
                }
            }, fortuneDelay);
            updateJackpotDisplay(data.current_jackpot);
            updateBalanceDisplay(data.user_balance);
        } catch (e) {
            console.error("Error display results:", e);
            displayError(e.message || "Could not display reading.", false);
            if (typeof data?.user_balance === "number") {
                updateBalanceDisplay(data.user_balance);
            }
        } finally {
            if (sessionId) {
                resetButtonState(true);
            } else {
                resetButtonState(false, "Session Error");
            }
        }
    }
    // --- Add this new function ---
    async function notifyDepositSuccess(userSessionId, paidHash, paidAmount) {
        console.log(
            `Notifying backend of successful deposit. Session: ${userSessionId.substring(0, 6)}, Amount: ${paidAmount}`,
        );
        try {
            const response = await fetch("/api/confirm-deposit-payment", {
                // Use NEW endpoint
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: userSessionId,
                    paymentHash: paidHash,
                    amount: paidAmount,
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(
                    errData.error ||
                        `Backend confirmation failed (${response.status})`,
                );
            }

            const data = await response.json();
            console.log("Backend deposit confirmation successful:", data);

            // Now refresh the balance display on the frontend
            await fetchBalance();
        } catch (error) {
            console.error("Error notifying backend of deposit success:", error);
            // Display error to user? Maybe on main screen if modal is closing.
            displayError(`Balance update failed: ${error.message}`, false);
        }
    }
    async function performCardDraw(confirmedPaymentHash) {
        if (!sessionId) {
            displayError("Session error.", false);
            resetButtonState(false, "Session Error");
            return;
        }
        if (!confirmedPaymentHash || confirmedPaymentHash.length !== 64) {
            displayError("Payment confirmation lost.", false);
            if (sessionId) updateBalanceDisplay(currentWithdrawableBalance);
            return;
        }
        resetButtonState(false, "Drawing...");
        resetFortuneDisplay("Payment Successful! Consulting the Oracle...");
        if (fortuneDisplay) {
            fortuneDisplay.style.color = "#77cc77";
            fortuneDisplay.classList.remove("fortune-visible", "fortune-win");
            fortuneDisplay.style.opacity = "1";
        }
        if (cardDisplay) cardDisplay.innerHTML = "";
        await new Promise((r) => setTimeout(r, 1500));
        const messages = [
            "Divining your fate...",
            "Consulting the cards...",
            "Gazing into your future...",
            "The blockchain whispers...",
            "Decoding the oracle...",
        ];
        const msg = messages[Math.floor(Math.random() * messages.length)];
        if (fortuneDisplay) {
            fortuneDisplay.textContent = msg;
            fortuneDisplay.style.color = "";
            fortuneDisplay.style.opacity = "1";
        }
        if (paymentHash === confirmedPaymentHash) {
            paymentHash = null;
        } else {
            console.warn("Global hash mismatch on clear.");
        }
        try {
            const response = await fetch(DRAW_CARDS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: sessionId }),
            });
            if (!response.ok) {
                let e = `Oracle comms failed (${response.status})`;
                try {
                    const be = await response.json();
                    e = be.error || e;
                } catch (x) {}
                throw new Error(e);
            }
            const data = await response.json();
            displayDrawResults(data);
        } catch (error) {
            console.error("Card Draw Error:", error);
            if (fortuneDisplay) {
                fortuneDisplay.style.opacity = "1";
            }
            displayError(error.message || "Could not get reading.", false);
            if (sessionId) {
                updateBalanceDisplay(currentWithdrawableBalance);
            } else {
                resetButtonState(false, "Session Error");
            }
        }
    }
    async function generateLnurlWithdraw() {
        const inputField = withdrawAmountInputField;
        const amountDisp = withdrawAmountDisplay;
        if (!sessionId) {
            displayError("Session error.", false, true);
            return;
        }
        let requestedAmount = null;
        if (inputField) {
            const val = inputField.value.trim();
            if (val !== "") {
                const p = parseInt(val);
                if (!isNaN(p) && p > 0) {
                    requestedAmount = p;
                } else {
                    displayError("Invalid amount.", false, true);
                    return;
                }
            }
        }
        if (withdrawStatus) {
            withdrawStatus.textContent = "Generating link...";
            withdrawStatus.className = "";
            withdrawStatus.style.color = "#ffcc66";
        }
        if (amountDisp)
            amountDisp.textContent = `Current Balance: ${currentWithdrawableBalance} sats`;
        try {
            const response = await fetch(GENERATE_LNURL_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: sessionId,
                    amount: requestedAmount,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(
                    data.details ||
                        data.error ||
                        `Link gen failed (${response.status})`,
                );
            }
            if (
                !data.lnurl ||
                !data.link_id ||
                typeof data.withdrawn_amount === "undefined"
            ) {
                throw new Error("Invalid LNURL data (missing link_id?).");
            }
            currentLnurlString = data.lnurl;
            currentLnurlLinkId = data.link_id;
            const withdrawnAmount = data.withdrawn_amount;
            console.log(
                `LNURL generated for ${withdrawnAmount} sats. Link ID: ${currentLnurlLinkId.substring(0, 8)}...`,
            );
            if (withdrawStatus) {
                withdrawStatus.textContent = `Scan/Paste LNURL for ${withdrawnAmount} sats - Waiting for Claim...`;
                withdrawStatus.className = "";
                withdrawStatus.style.color = "#ffcc66";
            }
            if (withdrawLnurlText) {
                withdrawLnurlText.textContent = currentLnurlString;
                withdrawLnurlText.classList.add("clickable-lnurl");
            }
            if (amountDisp)
                amountDisp.textContent = `Current Balance: ${currentWithdrawableBalance} sats | Amount to Withdraw: ${withdrawnAmount} sats`;
            const canvas = document.getElementById("withdraw-qrcode-canvas");
            if (canvas && typeof QRCode !== "undefined") {
                try {
                    const qrSize = Math.min(
                        withdrawQrcodeContainer.offsetWidth * 0.85,
                        240,
                    );
                    QRCode.toCanvas(
                        canvas,
                        currentLnurlString.toUpperCase(),
                        { width: qrSize, margin: 1, errorCorrectionLevel: "L" },
                        function (error) {
                            if (error) {
                                console.error("LNURL QR error:", error);
                                displayError(
                                    "Could not generate QR code.",
                                    false,
                                    true,
                                );
                            }
                        },
                    );
                } catch (qrError) {
                    console.error("LNURL QR exception:", qrError);
                    displayError("QR generation failed.", false, true);
                }
            } else {
                displayError("Cannot display QR code.", false, true);
            }
            startLnurlClaimPolling(
                currentLnurlLinkId,
                sessionId,
                withdrawnAmount,
            );
        } catch (error) {
            console.error("Generate LNURL Error:", error);
            // Extract message, prioritizing details if available from our specific backend error format
            const displayMsg =
                error.details ||
                error.message ||
                "Could not create withdraw link.";
            displayError(displayMsg, false, true); // Pass the potentially clearer message

            if (amountDisp) amountDisp.textContent = `Withdrawal Failed`;
            stopLnurlClaimPolling("Error during generation");
        }
    }
    function copyToClipboard(
        textToCopy,
        feedbackElement, // The element clicked (e.g., QR container or text element)
        successClassOrTarget, // CSS class for feedback or target status element ID
        isQrCode = false,
        isLnurlText = false, // Keep this distinction for potential future use if needed
    ) {
        if (!textToCopy || !feedbackElement) {
            console.warn("copyToClipboard: Missing text or feedback element.");
            return;
        }

        navigator.clipboard
            .writeText(textToCopy)
            .then(() => {
                // --- Feedback Logic ---
                let targetStatusElement = null;
                let baseMessage = "Copied!";
                const qrSuccessClass = "copy-success-qr"; // Class for the QR container border/glow
                const textSuccessClass = "copy-success"; // Class for the text element itself

                if (isQrCode) {
                    // Determine which status element and base message to use based on the clicked QR container
                    if (feedbackElement === qrcodeContainer && paymentStatus) {
                        targetStatusElement = paymentStatus;
                        baseMessage = "Invoice Copied!";
                    } else if (
                        feedbackElement === withdrawQrcodeContainer &&
                        withdrawStatus
                    ) {
                        targetStatusElement = withdrawStatus;
                        baseMessage = "LNURL Copied!";
                    } else if (
                        feedbackElement === depositQrcodeContainer &&
                        depositStatus
                    ) {
                        targetStatusElement = depositStatus;
                        baseMessage = "Deposit Invoice Copied!";
                    }

                    // Apply feedback if we found a target status element
                    if (targetStatusElement) {
                        const feedbackMsg = `✔️ ${baseMessage}`;
                        const currentText = targetStatusElement.textContent;
                        // Store original state ONLY if not already showing "Copied!" feedback
                        const tempKey = `originalState_${targetStatusElement.id}`;
                        if (
                            !targetStatusElement[tempKey] ||
                            !currentText.includes("Copied!")
                        ) {
                            targetStatusElement[tempKey] = {
                                text: currentText,
                                className: targetStatusElement.className,
                                color:
                                    targetStatusElement.style.color ||
                                    "#ffcc66", // Default if no style set
                            };
                        }

                        // Apply visual feedback to status element
                        targetStatusElement.textContent = feedbackMsg;
                        targetStatusElement.className = "copy-feedback"; // Simple class for text style if needed
                        targetStatusElement.style.color = "#77cc77"; // Force green for feedback

                        // Apply visual feedback to QR container element
                        if (feedbackElement.classList) {
                            feedbackElement.classList.add(qrSuccessClass);
                        }

                        // Set timeout to revert feedback
                        setTimeout(() => {
                            const storedOriginal = targetStatusElement[tempKey];
                            // Revert status element ONLY if it still shows the feedback message
                            if (
                                targetStatusElement.textContent ===
                                    feedbackMsg &&
                                storedOriginal
                            ) {
                                targetStatusElement.textContent =
                                    storedOriginal.text;
                                targetStatusElement.className =
                                    storedOriginal.className;
                                targetStatusElement.style.color =
                                    storedOriginal.color;
                            }
                            // Clean up stored state
                            delete targetStatusElement[tempKey];
                            // Remove class from QR container
                            if (feedbackElement.classList) {
                                feedbackElement.classList.remove(
                                    qrSuccessClass,
                                );
                            }
                        }, 1500); // Revert after 1.5 seconds
                    } else {
                        console.warn(
                            "copyToClipboard (QR): Could not find target status element for feedback.",
                        );
                    }
                } else {
                    // Feedback for clicking the TEXT element (invoice/lnurl)
                    const successClass = textSuccessClass; // Use the dedicated text success class
                    if (feedbackElement.classList) {
                        const originalText = feedbackElement.textContent; // Store original text content
                        const revertKey = "copyTimeoutActive";

                        // Prevent multiple rapid clicks causing issues
                        if (feedbackElement[revertKey]) return;

                        feedbackElement.classList.add(successClass);
                        feedbackElement.textContent = "✔️ Copied!";
                        feedbackElement[revertKey] = true; // Mark as active

                        setTimeout(() => {
                            feedbackElement.classList.remove(successClass);
                            // Revert text ONLY if it still shows "Copied!"
                            if (feedbackElement.textContent === "✔️ Copied!") {
                                // Restore correct original text based on ID
                                if (feedbackElement.id === "invoice-text") {
                                    feedbackElement.textContent =
                                        currentInvoiceString;
                                } else if (
                                    feedbackElement.id === "withdraw-lnurl-text"
                                ) {
                                    feedbackElement.textContent =
                                        currentLnurlString;
                                } else if (
                                    feedbackElement.id ===
                                    "deposit-invoice-text"
                                ) {
                                    feedbackElement.textContent =
                                        currentDepositInvoice;
                                } else {
                                    feedbackElement.textContent = originalText; // Fallback
                                }
                            }
                            delete feedbackElement[revertKey]; // Clear active flag
                        }, 1500);
                    }
                }
            })
            .catch((err) => {
                console.error(`Clipboard write failed: `, err);
                // Basic error feedback on the clicked element if it's not a QR code
                if (
                    feedbackElement &&
                    !isQrCode &&
                    feedbackElement.textContent
                ) {
                    const originalText = feedbackElement.textContent;
                    feedbackElement.textContent = "Copy Failed!";
                    feedbackElement.classList.add("error"); // Add error class if defined
                    setTimeout(() => {
                        feedbackElement.classList.remove("error");
                        feedbackElement.textContent = originalText;
                    }, 2000);
                } else {
                    // Fallback for QR code copy errors or elements without text
                    displayError("Could not copy to clipboard.", false); // Use general display error
                }
            });
    }
    function connectWebSocket() {
        console.log("LOG: connectWebSocket called");
        const wsProtocol =
            window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}`;
        console.log(`Attempting WebSocket connection to ${wsUrl}...`);
        if (
            socket &&
            (socket.readyState === WebSocket.OPEN ||
                socket.readyState === WebSocket.CONNECTING)
        ) {
            console.log("Closing existing WebSocket connection...");
            socket.close();
        }
        if (wsReconnectTimeout) {
            clearTimeout(wsReconnectTimeout);
            wsReconnectTimeout = null;
        }
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
            console.log("WebSocket Connected");
            if (wsReconnectTimeout) {
                clearTimeout(wsReconnectTimeout);
                wsReconnectTimeout = null;
            }
        };
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (
                    message.type === "jackpotUpdate" &&
                    typeof message.amount === "number"
                ) {
                    updateJackpotDisplay(message.amount);
                } else {
                    /* console.log("WS: Received other msg type:", message); */
                }
            } catch (e) {
                console.error("Failed to parse WS message:", event.data, e);
            }
        };
        socket.onerror = (error) => {
            console.error("WebSocket Error:", error);
            if (socket) {
                socket.close();
                socket = null;
            }
        };
        socket.onclose = (event) => {
            console.log(
                `WebSocket Closed. Code: ${event.code}, Reason: ${event.reason ? event.reason.toString() : "N/A"}. Reconnecting...`,
            );
            socket = null;
            if (!wsReconnectTimeout) {
                wsReconnectTimeout = setTimeout(
                    connectWebSocket,
                    WS_RECONNECT_DELAY,
                );
            }
        };
    }
    async function initializeSession() {
        console.log("LOG: initializeSession called");
        resetButtonState(false, "Initializing...");
        sessionId = localStorage.getItem("madameSatoshiSessionId") || null;

        if (sessionId) {
            console.log(
                "LOG: Found existing sessionId:",
                sessionId.substring(0, 6),
            );
            await fetchBalance(); // This involves a backend call. fetchBalance might nullify sessionId if it's invalid.

            if (sessionId) {
                // Re-check sessionId as fetchBalance could have cleared it on a 404
                const canAfford = currentWithdrawableBalance >= PLAY_COST;
                resetButtonState(
                    true,
                    canAfford
                        ? `Play (Use ${PLAY_COST} Sats Balance)`
                        : `Play (Pay ${PLAY_COST} Sats)`,
                );
                console.log("LOG: Buttons reset after existing session init.");
                if (withdrawButton)
                    withdrawButton.disabled = currentWithdrawableBalance <= 0; // Also ensure withdraw button state is correct
            } else {
                // sessionId became null, means fetchBalance encountered an issue (e.g., 404) and cleared it.
                // We need to fetch a new session.
                console.error(
                    "LOG: SessionId was invalid or expired. Fetching new one.",
                );
                // This will now fall through to the 'fetch new session' logic below
                // because 'sessionId' is now null.
            }
        }

        // If sessionId is still null here (either it wasn't in localStorage, or it was invalid and cleared by fetchBalance)
        if (!sessionId) {
            console.log("LOG: No valid existing sessionId, fetching new one.");
            try {
                const response = await fetch(SESSION_URL); // Fetches /api/session
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(
                        `LOG: Session fetch failed: ${response.status}`,
                        errorText,
                    );
                    throw new Error(
                        `Session fetch failed: ${response.status}. ${errorText}`,
                    );
                }
                const data = await response.json();
                if (!data.sessionId) {
                    console.error(
                        "LOG: No sessionId in response from /api/session",
                        data,
                    );
                    throw new Error("No sessionId received.");
                }
                sessionId = data.sessionId;
                localStorage.setItem("madameSatoshiSessionId", sessionId);
                console.log(
                    `LOG: New session ID: ${sessionId.substring(0, 6)}...`,
                );
                updateBalanceDisplay(0); // Initialize balance to 0 for new session
                if (withdrawButton) withdrawButton.disabled = true; // Withdraw disabled for new session with 0 balance
                resetButtonState(true, `Play (Pay ${PLAY_COST} Sats)`);
                console.log("LOG: Buttons reset after new session init.");
            } catch (error) {
                console.error("Error initializing new session:", error);
                displayError(
                    "Could not establish session. Please refresh.",
                    false,
                );
                resetButtonState(false, "Session Error");
                if (withdrawButton) withdrawButton.disabled = true;
            }
        }
    }
    async function fetchBalance() {
        console.log("LOG: fetchBalance called");
        if (!sessionId) {
            return;
        }
        const balanceUrl = BALANCE_URL_BASE + sessionId;
        try {
            const response = await fetch(balanceUrl);
            if (!response.ok) {
                if (response.status === 404 || response.status === 400) {
                    localStorage.removeItem("madameSatoshiSessionId");
                    sessionId = null;
                    displayError("Session expired.", false);
                    resetButtonState(false, "Session Error");
                    updateBalanceDisplay(0);
                } else {
                    console.error(
                        `Server error check balance: ${response.status}.`,
                    );
                }
                return;
            }
            const data = await response.json();
            if (typeof data.balance === "number") {
                updateBalanceDisplay(data.balance);
            } else {
                updateBalanceDisplay(0);
            }
        } catch (error) {
            console.error(`Network error fetch balance:`, error);
            updateBalanceDisplay(currentWithdrawableBalance);
        }
    }
    function setupEventListeners() {
        console.log("LOG: setupEventListeners called");
        if (depositAmountInputField && generateDepositInvoiceButton) {
            depositAmountInputField.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.keyCode === 13) {
                    event.preventDefault();
                    generateDepositInvoiceButton.click();
                }
            });
        }
        if (withdrawAmountInputField && updateWithdrawLinkButton) {
            withdrawAmountInputField.addEventListener("keydown", (event) => {
                // Check if the key pressed was 'Enter'
                if (event.key === "Enter" || event.keyCode === 13) {
                    event.preventDefault(); // Prevent default form submission if any
                    // Trigger a click on the "Update LNURL" button
                    updateWithdrawLinkButton.click();
                }
            });
        }
        if (updateWithdrawLinkButton) {
            updateWithdrawLinkButton.addEventListener("click", () => {
                console.log("Update Withdraw Link button clicked.");
                // Optional: Add brief visual feedback like disabling the button
                updateWithdrawLinkButton.disabled = true;
                updateWithdrawLinkButton.textContent = "Updating...";

                // Call the existing function to generate a new LNURL
                generateLnurlWithdraw().finally(() => {
                    // Re-enable button regardless of success/failure
                    updateWithdrawLinkButton.disabled = false;
                    updateWithdrawLinkButton.textContent = "Update Link";
                });
            });
        } else {
            console.error("Init Error: Update Withdraw Link button not found!");
        }
        if (drawButton) {
            drawButton.addEventListener("click", async () => {
                if (!sessionId || drawButton.disabled) return;
                if (currentWithdrawableBalance >= PLAY_COST) {
                    /* Pay from Balance */ resetButtonState(
                        false,
                        "Using Balance...",
                    );
                    resetFortuneDisplay("Deducting sats...");
                    try {
                        const r = await fetch(DRAW_FROM_BALANCE_URL, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ sessionId: sessionId }),
                        });
                        if (!r.ok) {
                            let e = `Draw balance failed (${r.status})`;
                            try {
                                const d = await r.json();
                                e = d.error || e;
                            } catch (x) {}
                            throw new Error(e);
                        }
                        const data = await r.json();
                        displayDrawResults(data);
                    } catch (error) {
                        console.error("Error draw from balance:", error);
                        displayError(error.message || "Could not play.", false);
                        if (sessionId) {
                            updateBalanceDisplay(currentWithdrawableBalance);
                            resetButtonState(true);
                        } else {
                            resetButtonState(false, "Session Error");
                        }
                    }
                } else {
                    /* Pay with Invoice */ resetButtonState(
                        false,
                        "Generating Invoice...",
                    );
                    resetFortuneDisplay("Connecting to LN...");
                    paymentHash = null;
                    currentInvoiceString = "";
                    try {
                        const r = await fetch(CREATE_INVOICE_URL, {
                            method: "POST",
                        });
                        if (!r.ok) {
                            let e = `Invoice creation failed (${r.status})`;
                            try {
                                const d = await r.json();
                                e = d.error || e;
                            } catch (x) {}
                            throw new Error(e);
                        }
                        const data = await r.json();
                        if (
                            !data?.payment_hash ||
                            !data?.payment_request ||
                            data.payment_hash.length !== 64
                        ) {
                            throw new Error("Invalid invoice data.");
                        }
                        paymentHash = data.payment_hash;
                        showPaymentModal(
                            data.payment_request,
                            data.payment_hash,
                        );
                        startInvoicePolling();
                    } catch (error) {
                        console.error("Error invoice creation/fetch:", error);
                        paymentHash = null;
                        currentInvoiceString = "";
                        displayError(
                            error.message || "Could not create invoice.",
                            false,
                        );
                        if (sessionId) {
                            updateBalanceDisplay(currentWithdrawableBalance);
                            resetButtonState(true);
                        } else {
                            resetButtonState(false, "Session Error");
                        }
                    }
                }
            });
        } else {
            console.error("Init Error: Draw button not found!");
        }
        if (infoTrigger) {
            infoTrigger.addEventListener("click", (event) => {
                if (instructionsArea) {
                    event.stopPropagation();
                    instructionsArea.classList.toggle("is-visible");
                }
            });
        }
        if (modalCloseButton) {
            modalCloseButton.addEventListener("click", () =>
                hidePaymentModal("modalCloseButton"),
            );
        }
        if (withdrawModalCloseButton) {
            withdrawModalCloseButton.addEventListener("click", () =>
                hideWithdrawModal("withdrawModalCloseButton"),
            );
        }
        document.addEventListener("click", (event) => {
            if (
                instructionsArea?.classList.contains("is-visible") &&
                infoTrigger &&
                !infoTrigger.contains(event.target) &&
                !instructionsArea.contains(event.target)
            ) {
                instructionsArea.classList.remove("is-visible");
            }
            if (
                paymentModal?.classList.contains("is-visible") &&
                event.target === paymentModal
            ) {
                hidePaymentModal("clickOutsidePayment");
            }
            if (
                withdrawModal?.classList.contains("is-visible") &&
                event.target === withdrawModal
            ) {
                hideWithdrawModal("clickOutsideWithdraw");
            }
            if (
                depositModal?.classList.contains("is-visible") &&
                event.target === depositModal
            ) {
                hideDepositModal("clickOutsideDeposit");
            }
        });
        if (depositButton) {
            depositButton.addEventListener("click", () => {
                if (!sessionId) {
                    // Ensure session exists
                    displayError(
                        "Session not initialized. Please wait or refresh.",
                        false,
                    );
                    return;
                }
                showDepositModal();
            });
        } else {
            console.error("Init Error: Deposit button not found!");
        }
        if (depositModalCloseButton) {
            depositModalCloseButton.addEventListener("click", () =>
                hideDepositModal("depositModalCloseButton"),
            );
        }
        if (generateDepositInvoiceButton) {
            generateDepositInvoiceButton.addEventListener("click", async () => {
                if (!sessionId || !depositAmountInputField || !depositStatus)
                    return;

                const amount = parseInt(depositAmountInputField.value.trim());

                if (isNaN(amount) || amount <= 0) {
                    depositStatus.textContent =
                        "Error: Please enter a valid positive amount.";
                    depositStatus.className = "error";
                    depositStatus.style.color = "#ff6b6b";
                    return;
                }

                depositStatus.textContent = "Generating invoice...";
                depositStatus.className = "";
                depositStatus.style.color = "#ffcc66";
                depositQrcodeContainer.style.display = "none"; // Hide previous QR if any
                depositInvoiceText.style.display = "none"; // Hide previous text if any
                generateDepositInvoiceButton.disabled = true; // Disable button during generation

                try {
                    const response = await fetch(CREATE_DEPOSIT_INVOICE_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            amount: amount,
                            sessionId: sessionId,
                        }), // Send amount and session
                    });

                    const data = await response.json(); // Always try to parse JSON

                    if (!response.ok) {
                        throw new Error(
                            data.error ||
                                `Invoice generation failed (${response.status})`,
                        );
                    }

                    if (!data.payment_request || !data.payment_hash) {
                        throw new Error(
                            "Invalid invoice data received from server.",
                        );
                    }

                    currentDepositInvoice = data.payment_request;
                    currentDepositHash = data.payment_hash;

                    depositStatus.textContent = `Invoice generated for ${amount} sats. Please pay.`;
                    depositStatus.className = ""; // Reset class if it was error
                    depositStatus.style.color = "#ffcc66"; // Back to waiting color

                    // Display QR Code
                    if (
                        depositQrcodeContainer &&
                        typeof QRCode !== "undefined"
                    ) {
                        depositQrcodeContainer.innerHTML =
                            '<canvas id="deposit-qrcode-canvas"></canvas>'; // Ensure canvas is fresh
                        const canvas = document.getElementById(
                            "deposit-qrcode-canvas",
                        );
                        const qrSize = Math.min(
                            depositQrcodeContainer.offsetWidth * 0.85,
                            240,
                        );
                        QRCode.toCanvas(
                            canvas,
                            currentDepositInvoice.toUpperCase(),
                            {
                                width: qrSize,
                                margin: 1,
                                errorCorrectionLevel: "L",
                            },
                            function (error) {
                                if (error) {
                                    console.error(
                                        "Deposit QR generation error:",
                                        error,
                                    );
                                    depositStatus.textContent =
                                        "Error: Could not generate QR code.";
                                    depositStatus.className = "error";
                                } else {
                                    depositQrcodeContainer.style.display =
                                        "inline-block"; // Show QR container
                                }
                            },
                        );
                    } else {
                        depositStatus.textContent =
                            "Error: QR Code library not ready.";
                        depositStatus.className = "error";
                    }

                    // Display Invoice Text
                    if (depositInvoiceText) {
                        depositInvoiceText.textContent = currentDepositInvoice;
                        depositInvoiceText.classList.add("clickable-invoice"); // Make it clickable
                        depositInvoiceText.style.display = "block"; // Show text container
                    }
                    if (currentDepositHash && amount > 0) {
                        console.log("Calling startDepositInvoicePolling..."); // Debug log
                        startDepositInvoicePolling(currentDepositHash, amount);
                    } else {
                        console.error(
                            "Cannot start deposit polling - hash or amount invalid",
                            currentDepositHash,
                            amount,
                        );
                    }
                    // Start polling to check for payment
                    if (currentDepositHash && amount > 0) {
                        console.log("Calling startDepositInvoicePolling..."); // Add for debugging
                        startDepositInvoicePolling(currentDepositHash, amount);
                    } else {
                        console.error(
                            "Cannot start deposit polling - hash or amount invalid",
                            currentDepositHash,
                            amount,
                        );
                    }
                } catch (error) {
                    console.error("Error generating deposit invoice:", error);
                    depositStatus.textContent = `Error: ${error.message}`;
                    depositStatus.className = "error";
                    depositStatus.style.color = "#ff6b6b";
                } finally {
                    generateDepositInvoiceButton.disabled = false; // Re-enable button
                }
            });
        }
        // Add inside setupEventListeners, similar to others
        if (depositInvoiceText) {
            depositInvoiceText.addEventListener("click", () => {
                if (
                    currentDepositInvoice &&
                    depositInvoiceText.classList.contains("clickable-invoice")
                ) {
                    copyToClipboard(
                        currentDepositInvoice,
                        depositInvoiceText,
                        "copy-success",
                        false,
                        false,
                    );
                }
            });
        }
        if (depositQrcodeContainer) {
            depositQrcodeContainer.addEventListener("click", () => {
                if (currentDepositInvoice) {
                    copyToClipboard(
                        currentDepositInvoice,
                        depositQrcodeContainer,
                        "copy-success-qr",
                        true,
                        false,
                    );
                }
            });
        }
        if (withdrawButton) {
            withdrawButton.addEventListener("click", () => {
                console.log(
                    `LOG: Withdraw button clicked! Current Balance: ${currentWithdrawableBalance}, Button Disabled State: ${withdrawButton.disabled}`,
                );
                if (withdrawButton.disabled && currentWithdrawableBalance > 0) {
                    return;
                }
                if (currentWithdrawableBalance > 0) {
                    showWithdrawModal();
                } else {
                    if (balanceInfo) {
                        balanceInfo.classList.add("flash-warn");
                        setTimeout(() => {
                            balanceInfo.classList.remove("flash-warn");
                        }, 700);
                    }
                }
            });
        }
        if (invoiceTextElement) {
            invoiceTextElement.addEventListener("click", () => {
                if (
                    currentInvoiceString &&
                    invoiceTextElement.classList.contains("clickable-invoice")
                ) {
                    copyToClipboard(
                        currentInvoiceString,
                        invoiceTextElement,
                        "copy-success",
                        false,
                        false,
                    );
                }
            });
        }
        if (qrcodeContainer) {
            qrcodeContainer.addEventListener("click", () => {
                if (currentInvoiceString) {
                    copyToClipboard(
                        currentInvoiceString,
                        qrcodeContainer,
                        "copy-success-qr",
                        true,
                        false,
                    );
                }
            });
        }
        if (withdrawLnurlText) {
            withdrawLnurlText.addEventListener("click", () => {
                if (
                    currentLnurlString &&
                    withdrawLnurlText.classList.contains("clickable-lnurl")
                ) {
                    copyToClipboard(
                        currentLnurlString,
                        withdrawLnurlText,
                        "copy-success",
                        false,
                        true,
                    );
                }
            });
        }
        if (withdrawQrcodeContainer) {
            withdrawQrcodeContainer.addEventListener("click", () => {
                if (currentLnurlString) {
                    copyToClipboard(
                        currentLnurlString,
                        withdrawQrcodeContainer,
                        "copy-success-qr",
                        true,
                        false,
                    );
                }
            });
        }
        console.log("All event listeners setup complete.");
    }

    // --- Initial Setup ---
    console.log("--- Madame Satoshi Initializing Frontend ---");
    try {
        resetFortuneDisplay();
        updateJackpotDisplay(0);
        updateBalanceDisplay(0);
        resetButtonState(false, "Initializing...");
        setupEventListeners();
        initializeSession();
        connectWebSocket();
        console.log("--- Frontend Initialization Sequence Complete ---");
    } catch (initError) {
        console.error(
            "!!! CRITICAL ERROR during initial setup execution:",
            initError,
        );
        displayError("Fatal error during startup execution.", false);
        resetButtonState(false, "FATAL ERROR");
    }
}); // End DOMContentLoaded
