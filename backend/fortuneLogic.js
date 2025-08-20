// --- START OF FILE backend/fortuneLogic.js ---

// --- Tarot Card Data (with Advice Categories) ---
const majorArcana = [
    // Categories: security, backup, strategy, privacy, network, spending, hodl, learning, tech_dev, general
    {
        name: "00 The Fool",
        number: "00",
        image: "0-fool.webp",
        keywords: [
            "a risky leap",
            "new beginnings",
            "potential volatility",
            "untested paths",
        ],
        advice_category: "strategy",
    },
    {
        name: "I The Magician",
        number: "I",
        image: "1-magician.webp",
        keywords: [
            "skillful execution",
            "manifesting value",
            "resourcefulness",
            "technical mastery",
        ],
        advice_category: "tech_dev",
    },
    {
        name: "II The High Priestess",
        number: "II",
        image: "2-high-priestess.webp",
        keywords: [
            "hidden knowledge",
            "trusting intuition",
            "cypherpunk secrets",
            "verifying code",
        ],
        advice_category: "privacy",
    },
    {
        name: "III The Empress",
        number: "III",
        image: "3-empress.webp",
        keywords: [
            "creative abundance",
            "nurturing growth",
            "stacking sats",
            "fertile innovation",
        ],
        advice_category: "spending",
    },
    {
        name: "IV The Emperor",
        number: "IV",
        image: "4-emperor.webp",
        keywords: [
            "establishing structure",
            "regulatory control",
            "stable foundations",
            "protocol rules",
        ],
        advice_category: "security",
    },
    {
        name: "V The Hierophant",
        number: "V",
        image: "5-hierophant.webp",
        keywords: [
            "legacy systems",
            "institutional adoption",
            "learning tradition",
            "established consensus",
        ],
        advice_category: "learning",
    },
    {
        name: "VI The Lovers",
        number: "VI",
        image: "6-lovers.webp",
        keywords: [
            "important choices",
            "community alignment",
            "network collaboration",
            "harmonious partnerships",
        ],
        advice_category: "strategy",
    },
    {
        name: "VII The Chariot",
        number: "VII",
        image: "7-chariot.webp",
        keywords: [
            "determined drive",
            "overcoming obstacles",
            "focused ambition",
            "transaction speed",
        ],
        advice_category: "tech_dev",
    },
    {
        name: "VIII Strength",
        number: "VIII",
        image: "8-strength.webp",
        keywords: [
            "inner fortitude",
            "HODLing strong",
            "resilience to FUD",
            "patient courage",
        ],
        advice_category: "hodl",
    },
    {
        name: "IX The Hermit",
        number: "IX",
        image: "9-hermit.webp",
        keywords: [
            "deep research",
            "seeking truth",
            "independent verification",
            "sovereign thought",
        ],
        advice_category: "learning",
    },
    {
        name: "X Wheel of Fortune",
        number: "X",
        image: "10-wheel-of-fortune.webp",
        keywords: [
            "market cycles",
            "inevitable change",
            "adapting to trends",
            "DCA timing",
        ],
        advice_category: "strategy",
    },
    {
        name: "XI Justice",
        number: "XI",
        image: "11-justice.webp",
        keywords: [
            "protocol fairness",
            "immutable truth",
            "transparent accountability",
            "code is law",
        ],
        advice_category: "network",
    },
    {
        name: "XII The Hanged Man",
        number: "XII",
        image: "12-hanged-man.webp",
        keywords: [
            "a necessary pause",
            "shifting perspective",
            "calculated risk",
            "low time preference",
        ],
        advice_category: "hodl",
    },
    {
        name: "XIII Death",
        number: "XIII",
        image: "13-death.webp",
        keywords: [
            "radical transformation",
            "ending old ways",
            "protocol upgrades",
            "creative destruction",
        ],
        advice_category: "tech_dev",
    },
    {
        name: "XIV Temperance",
        number: "XIV",
        image: "14-temperance.webp",
        keywords: [
            "finding balance",
            "integrating systems",
            "patient development",
            "portfolio moderation",
        ],
        advice_category: "strategy",
    },
    {
        name: "XV The Tower",
        number: "XV",
        image: "15-tower.webp",
        keywords: [
            "sudden disruption",
            "exchange collapse",
            "protocol failure",
            "market shock",
        ],
        advice_category: "security",
    },
    {
        name: "XVI The Star",
        number: "XVI",
        image: "16-star.webp",
        keywords: [
            "renewed hope",
            "open-source inspiration",
            "guiding light",
            "optimistic future",
        ],
        advice_category: "network",
    },
    {
        name: "XVII The Moon",
        number: "XVII",
        image: "17-moon.webp",
        keywords: [
            "navigating uncertainty",
            "market FUD",
            "hidden variables",
            "shadowy super coders",
        ],
        advice_category: "privacy",
    },
    {
        name: "XVIII The Sun",
        number: "XVIII",
        image: "18-sun.webp",
        keywords: [
            "clarity and success",
            "peak enlightenment",
            "bull market joy",
            "protocol vitality",
        ],
        advice_category: "general",
    },
    {
        name: "XIX Judgment",
        number: "XIX",
        image: "19-judgement.webp",
        keywords: [
            "a final reckoning",
            "code audit results",
            "awakening to truth",
            "network consensus",
        ],
        advice_category: "backup",
    },
    {
        name: "XX The World",
        number: "XX",
        image: "20-world.webp",
        keywords: [
            "global adoption",
            "project completion",
            "network integration",
            "ultimate success",
        ],
        advice_category: "network",
    },
    {
        name: "XXI Ace of Pentacles",
        number: "XXI",
        image: "21-ace-of-pentacles.webp",
        keywords: [
            "new financial opportunity",
            "seed investment",
            "tangible results",
            "staking rewards",
        ],
        advice_category: "spending",
    },
];

// --- Advice Snippets ---
const advicePools = {
    security: [
        "Secure keys offline.",
        "Verify hardware wallet RNG.",
        "Use strong, unique passphrases.",
        "Update node/wallet software regularly.",
        "Beware unsolicited DMs/offers.",
    ],
    backup: [
        "Verify your seed phrase backup.",
        "Consider metal seed storage.",
        "Test your recovery plan.",
        "Backup wallet files/configs.",
        "Multisig needs seeds, xpubs/paths & config.",
    ],
    strategy: [
        "Low time preference wins.",
        "DCA through market cycles.",
        "Define your Bitcoin strategy.",
        "Avoid FOMO & panic selling.",
        "Understand risk management.",
    ],
    privacy: [
        "Mind your UTXO privacy.",
        "Consider CoinJoin/mixing tools.",
        "Use Tor for node connections.",
        "Label addresses privately.",
        "Avoid KYC where possible/legal.",
    ],
    network: [
        "Run your own full node for sovereignty.",
        "Verify software signatures.",
        "Understand mempool dynamics/fees.",
        "Support Bitcoin Core development.",
        "Learn about Layer 2 solutions.",
    ],
    spending: [
        "Consolidate UTXOs wisely for lower fees.",
        "Label outgoing transactions.",
        "Understand replace-by-fee (RBF).",
        "Use Lightning for small payments.",
        "Spend & replace to build the circular economy.",
    ], // Added new advice
    hodl: [
        "Patience during volatility is key.",
        "HODL with conviction.",
        "Understand Bitcoin's long-term value.",
        "Resist FUD with knowledge.",
        "Secure cold storage is paramount.",
    ],
    learning: [
        "Never stop learning; read whitepapers.",
        "Verify, don't trust.",
        "Understand consensus rules.",
        "Research before investing.",
        "Follow reputable Bitcoin educators.",
    ],
    tech_dev: [
        "Contribute to open-source projects.",
        "Master Lightning Network tools.",
        "Learn basic cryptography principles.",
        "Explore Bitcoin scripting potential.",
        "Build on Bitcoin!",
    ],
    general: [
        "Not your keys, not your coins.",
        "Stay humble, stack sats.",
        "Focus on the fundamentals.",
        "Bitcoin fixes this (eventually).",
        "Separate signal from noise.",
        "Spend & replace; build the circular economy.",
    ], // Added new advice
};

// --- Helper Functions ---
function getRandomKeyword(card) {
    if (!card?.keywords?.length) return "an unknown influence";
    return card.keywords[Math.floor(Math.random() * card.keywords.length)];
}

function getRandomAdvice(category = "general") {
    const pool = advicePools[category] || advicePools.general;
    if (!pool?.length) return advicePools.general[0]; // Absolute fallback
    return pool[Math.floor(Math.random() * pool.length)];
}

function capitalizeFirstLetter(string) {
    if (!string) return "";
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// --- Draw Logic ---
function drawCards() {
    const deck = [...majorArcana];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.slice(0, 3);
}

// --- Fortune Calculation Logic [REVISED NON-WINNING PATH w/ Advice] ---
function calculateFortune(drawnCardObjects, poolAmount, minJackpotSeed) {
    let fortune = "";
    let sats_won = 0;
    let isJackpotWin = false;

    const cardNames = drawnCardObjects.map((cardObj) => {
        const parts = cardObj.name.split(" ");
        return parts.length > 2 ? parts.slice(1).join(" ") : parts[1];
    });
    const choose = (options) =>
        options[Math.floor(Math.random() * options.length)];

    const TIER_S_PERCENT = 1.0;
    const TIER_A_PERCENT = 0.35;
    const TIER_A_MIN_SATS = 75;
    const TIER_B_PERCENT = 0.15;
    const TIER_B_MIN_SATS = 21;
    const effectiveJackpotPool = Math.max(poolAmount, minJackpotSeed);

    // --- Check Winning Combinations First ---
    if (
        cardNames.includes("The Sun") &&
        cardNames.includes("The World") &&
        cardNames.includes("The Magician")
    ) {
        let p = effectiveJackpotPool;
        sats_won = Math.min(p, poolAmount);
        fortune = `*** JACKPOT! *** Sun (XVIII), World (XX), Magician (I)! Ultimate Bitcoin alignment! ${sats_won} sats added to your balance!`;
        isJackpotWin = true;
    } else if (
        cardNames.includes("The Sun") &&
        cardNames.includes("The World") &&
        cardNames.includes("Ace of Pentacles")
    ) {
        let p = Math.max(
            TIER_A_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_A_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Major Win! Brilliance (XVIII), completion (XX), new wealth (XXI)! +${sats_won} sats to your balance!`;
    } else if (
        cardNames.includes("The Emperor") &&
        cardNames.includes("The Empress") &&
        cardNames.includes("Strength")
    ) {
        let p = Math.max(
            TIER_A_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_A_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Major Win! Sovereign power (IV & III) and inner fortitude (VIII)! +${sats_won} sats to your balance!`;
    } else if (
        cardNames.includes("The Star") &&
        cardNames.includes("The Sun") &&
        cardNames.includes("Temperance")
    ) {
        let p = Math.max(
            TIER_A_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_A_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Major Win! Hope (XVI), clarity (XVIII), and balance (XIV) unite! +${sats_won} sats to your balance!`;
    } else if (
        cardNames.includes("Ace of Pentacles") &&
        cardNames.includes("Wheel of Fortune")
    ) {
        let p = Math.max(
            TIER_B_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_B_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Minor Win! Opportunity (XXI) meets good fortune (X)! +${sats_won} sats to your balance!`;
    } else if (
        cardNames.includes("The Chariot") &&
        cardNames.includes("Strength")
    ) {
        let p = Math.max(
            TIER_B_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_B_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Minor Win! Focused willpower (VII) and courage (VIII)! +${sats_won} sats to your balance!`;
    } else if (
        cardNames.includes("The Sun") &&
        cardNames.includes("The Lovers")
    ) {
        let p = Math.max(
            TIER_B_MIN_SATS,
            Math.floor(effectiveJackpotPool * TIER_B_PERCENT),
        );
        sats_won = Math.min(p, poolAmount);
        fortune = `Minor Win! Joyful alignment (XVIII) and connection (VI)! +${sats_won} sats to your balance!`;
    }

    // --- Non-Winning Fortunes: Sequential Templates with Advice ---
    else {
        const card1 = drawnCardObjects[0];
        const card2 = drawnCardObjects[1];
        const card3 = drawnCardObjects[2];

        const kw1 = getRandomKeyword(card1);
        const kw2 = getRandomKeyword(card2);
        const adviceCategory =
            card3.advice_category || card2.advice_category || "general";
        const adviceSnippet = getRandomAdvice(adviceCategory);

        // Define templates - **ENSURE THESE USE BACKTICKS ``**
        const templates = [
            `Initial ${kw1} (${card1.number}) encounters ${kw2} (${card2.number}). Practical advice: ${adviceSnippet} (${card3.number}).`,
            `Through ${kw1} (${card1.number}) and ${kw2} (${card2.number}), remember this key principle: ${adviceSnippet} (${card3.number}).`,
            `${kw1} (${card1.number}) sets the stage, ${kw2} (${card2.number}) presents a challenge. The wise action? ${adviceSnippet} (${card3.number}).`,
            `Focus on ${kw1} (${card1.number}); integrate ${kw2} (${card2.number}). Always be mindful to: ${adviceSnippet} (${card3.number}).`,
            `The path shows ${kw1} (${card1.number}), then ${kw2} (${card2.number}). Your Bitcoin focus now: ${adviceSnippet} (${card3.number}).`,
            `From ${kw1} (${card1.number}), influenced by ${kw2} (${card2.number}), consider this: ${adviceSnippet} (${card3.number}).`,
        ];

        fortune = choose(templates);
        fortune = capitalizeFirstLetter(fortune); // Ensure first letter is capitalized
    }

    if (fortune === "") {
        fortune =
            "The blockchain remains enigmatic... [Error generating fortune]";
    }
    sats_won = Math.max(0, Math.floor(sats_won));

    return { fortune: fortune, sats_won: sats_won, is_jackpot: isJackpotWin };
}

module.exports = { drawCards, calculateFortune };
// --- END OF FILE backend/fortuneLogic.js ---
