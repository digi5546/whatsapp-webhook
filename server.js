const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.json());

// ===============================
// ENVIRONMENT VARIABLES
// ===============================

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const ADMIN_PANEL_KEY = process.env.ADMIN_PANEL_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const GRAPH_API_VERSION = "v25.0";

// ===============================
// POSTGRESQL DATABASE
// ===============================

if (!DATABASE_URL) {
    console.error("DATABASE_URL is not configured.");
}

const pool = new Pool({
    connectionString: DATABASE_URL
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error);
});

// ===============================
// INITIALIZE DATABASE
// ===============================

async function initializeDatabase() {
    if (!DATABASE_URL) {
        throw new Error("DATABASE_URL is not configured.");
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS candidates (
            phone TEXT PRIMARY KEY,
            last_message TIMESTAMPTZ NOT NULL
        )
    `);

    // Add HR management columns if they do not exist
    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS name TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New'
    `);

    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'Pending'
    `);

    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS interview_status TEXT DEFAULT 'Not Scheduled'
    `);

    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''
    `);

    await pool.query(`
        ALTER TABLE candidates
        ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'New'
    `);

    // Store candidate message history
    await pool.query(`
        CREATE TABLE IF NOT EXISTS candidate_messages (
            id BIGSERIAL PRIMARY KEY,
            phone TEXT NOT NULL,
            direction TEXT NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT DEFAULT 'text',
            whatsapp_message_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_candidate_messages_phone_created
        ON candidate_messages (phone, created_at DESC)
    `);

    console.log("PostgreSQL database initialized successfully.");
}

// ===============================
// SAVE / UPDATE CANDIDATE
// ===============================

async function saveCandidate(phone) {
    try {
        await pool.query(
            `
            INSERT INTO candidates (phone, last_message)
            VALUES ($1, NOW())
            ON CONFLICT (phone)
            DO UPDATE SET last_message = NOW()
            `,
            [phone]
        );

        console.log("Candidate saved to PostgreSQL:", phone);

    } catch (error) {
        console.error(
            "Failed to save candidate to PostgreSQL:",
            error.message
        );
    }
}

async function saveCandidateMessage(
    phone,
    direction,
    message,
    messageType = "text",
    whatsappMessageId = null
) {
    try {
        await pool.query(
            `
            INSERT INTO candidate_messages
                (phone, direction, message, message_type, whatsapp_message_id)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
                phone,
                direction,
                message,
                messageType,
                whatsappMessageId
            ]
        );
    } catch (error) {
        console.error(
            "Failed to save candidate message:",
            error.message
        );
    }
}

// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
    res.send("WhatsApp Webhook is running!");
});

// ===============================
// META WEBHOOK VERIFICATION
// ===============================

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

// ===============================
// WHATSAPP TEXT MESSAGE
// ===============================

async function sendWhatsAppMessage(to, text) {
    const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
        `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: {
                body: text
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    await saveCandidateMessage(
        to,
        "outgoing",
        text,
        "text",
        data.messages && data.messages[0]
            ? data.messages[0].id
            : null
    );

    return data;
}

// ===============================
// WHATSAPP TEMPLATE MESSAGE
// ===============================

async function sendWhatsAppTemplate(to) {
    const url =
        `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
        `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            messaging_product: "whatsapp",

            to: to,

            type: "template",

            template: {
                name: "sales_trainee_update",

                language: {
                    code: "en"
                }
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    await saveCandidateMessage(
        to,
        "outgoing",
        "[sales_trainee_update template sent]",
        "template",
        data.messages && data.messages[0]
            ? data.messages[0].id
            : null
    );

    return data;
}

// ===============================
// RECRUITMENT AUTO REPLY
// ===============================

function getReply(messageText) {
    const text = messageText.trim().toLowerCase();

    if (
        text === "hi" ||
        text === "hello" ||
        text === "hey" ||
        text === "start" ||
        text === "menu"
    ) {
        return `👋 Welcome to Digi Wealth!
Thank you for your interest in the Sales Trainee position.

How can we help you?

1️⃣ Complete Onboarding Form
2️⃣ Talk to HR

Please reply with 1 or 2.`;
    }

    if (text === "1") {
        return `📋 Digi Wealth – Sales Trainee Onboarding

Thank you for applying for the Sales Trainee position at Digi Wealth.

Please complete the Onboarding Form using the link below:

🔗 https://docs.google.com/forms/d/e/1FAIpQLSe6hUHpqQ_2aYeSAVFGjJU8E7alJqE88CgiWsW9dEmBe0Qfdg/viewform?usp=header

Kindly ensure that all the information provided is accurate and complete.

Once we receive your completed form, our HR team will review your details and contact you regarding the next steps, including the interview/selection process.

If you have any questions while filling out the form, please reply with 2 to talk to HR.

Best regards,
HR Team
Digi Wealth`;
    }

    if (text === "2") {
        return `👨‍💼 Talk to HR

Thank you for contacting Digi Wealth HR.

Please type your question or message here, and our HR team will assist you regarding the Sales Trainee position.

Thank you.
HR Team
Digi Wealth`;
    }

    return `👋 Welcome to Digi Wealth!

Thank you for your interest in the Sales Trainee position.

Please choose an option:

1️⃣ Complete Onboarding Form
2️⃣ Talk to HR

Reply with 1 or 2.`;
}

// ===============================
// RECEIVE WHATSAPP MESSAGES
// ===============================

app.post("/webhook", (req, res) => {
    console.log("WhatsApp webhook received:");

    console.log(
        JSON.stringify(req.body, null, 2)
    );

    if (req.body.object === "whatsapp_business_account") {

        const entries = req.body.entry || [];

        entries.forEach((entry) => {

            const changes = entry.changes || [];

            changes.forEach((change) => {

                const value = change.value;

                // ===============================
                // INCOMING MESSAGES
                // ===============================

                if (value.messages) {

                    value.messages.forEach((message) => {

                        console.log("---------------");
                        console.log("MESSAGE RECEIVED");

                        console.log(
                            "From:",
                            message.from
                        );

                        console.log(
                            "Type:",
                            message.type
                        );

                        // ===============================
                        // SAVE CANDIDATE
                        // ===============================

                        saveCandidate(message.from);

                        // Save incoming message to history
                        const incomingMessageText =
                            message.type === "text"
                                ? message.text.body
                                : "[" + message.type + " message]";

                        saveCandidateMessage(
                            message.from,
                            "incoming",
                            incomingMessageText,
                            message.type,
                            message.id || null
                        );

                        // ===============================
                        // TEXT MESSAGE
                        // ===============================

                        if (message.type === "text") {

                            const incomingText =
                                message.text.body;

                            console.log(
                                "Message:",
                                incomingText
                            );

                            const reply =
                                getReply(incomingText);

                            sendWhatsAppMessage(
                                message.from,
                                reply
                            ).catch((error) => {

                                console.error(
                                    "Failed to send WhatsApp reply:",
                                    error.message
                                );

                            });
                        }

                        console.log("---------------");
                    });
                }

                // ===============================
                // STATUS UPDATES
                // ===============================

                if (value.statuses) {

                    value.statuses.forEach((status) => {

                        console.log(
                            "STATUS UPDATE"
                        );

                        console.log(
                            "ID:",
                            status.id
                        );

                        console.log(
                            "Status:",
                            status.status
                        );
                    });
                }
            });
        });
    }

    res.sendStatus(200);
});

// ===============================
// ADMIN AUTHENTICATION
// ===============================

function checkAdmin(req, res, next) {

    const key =
        req.headers["x-admin-key"];

    if (!ADMIN_PANEL_KEY) {

        return res
            .status(500)
            .send(
                "ADMIN_PANEL_KEY is not configured."
            );
    }

    if (key !== ADMIN_PANEL_KEY) {

        return res
            .status(401)
            .send("Unauthorized");
    }

    next();
}

// ===============================
// CANDIDATE LIST API
// ===============================

app.get(
    "/api/candidates",
    checkAdmin,
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    phone,
                    name,
                    status,
                    onboarding_status AS "onboardingStatus",
                    interview_status AS "interviewStatus",
                    notes,
                    category,
                    last_message AS "lastMessage"
                FROM candidates
                ORDER BY last_message DESC
            `);

            res.json(result.rows);

        } catch (error) {

            console.error(
                "Failed to load candidates:",
                error.message
            );

            res.status(500).json({
                error:
                    "Failed to load candidates."
            });
        }
    }
);

// ===============================
// UPDATE CANDIDATE
// ===============================

app.put(
    "/api/candidates/:phone",
    checkAdmin,
    async (req, res) => {

        try {

            const phone =
                String(
                    req.params.phone || ""
                ).replace(/\D/g, "");

            if (!phone) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Candidate WhatsApp number is required."
                    });
            }

            const name =
                String(
                    req.body.name || ""
                ).trim();

            const status =
                String(
                    req.body.status || "New"
                ).trim();

            const onboardingStatus =
                String(
                    req.body.onboardingStatus ||
                    "Pending"
                ).trim();

            const interviewStatus =
                String(
                    req.body.interviewStatus ||
                    "Not Scheduled"
                ).trim();

            const notes =
                String(
                    req.body.notes || ""
                ).trim();

            const allowedCategories = [
                "New",
                "Shortlisted",
                "Interview",
                "Selected",
                "Rejected",
                "On Hold"
            ];

            const category =
                allowedCategories.includes(
                    String(req.body.category || "").trim()
                )
                    ? String(req.body.category).trim()
                    : "New";

            await pool.query(
                `
                UPDATE candidates
                SET
                    name = $1,
                    status = $2,
                    onboarding_status = $3,
                    interview_status = $4,
                    notes = $5,
                    category = $6
                WHERE phone = $7
                `,
                [
                    name,
                    status,
                    onboardingStatus,
                    interviewStatus,
                    notes,
                    category,
                    phone
                ]
            );

            res.json({
                success: true,
                message: "Candidate updated successfully."
            });

        } catch (error) {

            console.error(
                "Failed to update candidate:",
                error.message
            );

            res.status(500).json({
                error:
                    "Failed to update candidate."
            });
        }
    }
);

// ===============================
// CANDIDATE MESSAGE HISTORY API
// ===============================

app.get(
    "/api/candidates/:phone/messages",
    checkAdmin,
    async (req, res) => {

        try {

            const phone =
                String(
                    req.params.phone || ""
                ).replace(/\\D/g, "");

            if (!phone) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Candidate WhatsApp number is required."
                    });
            }

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        direction,
                        message,
                        message_type AS "messageType",
                        created_at AS "createdAt"
                    FROM candidate_messages
                    WHERE phone = $1
                    ORDER BY created_at ASC
                    `,
                    [phone]
                );

            res.json(result.rows);

        } catch (error) {

            console.error(
                "Failed to load candidate messages:",
                error.message
            );

            res.status(500).json({
                error:
                    "Failed to load candidate messages."
            });
        }
    }
);

// ===============================
// HR PANEL
// ===============================

app.get("/hr", (req, res) => {

    res.send(`
<!DOCTYPE html>
<html>

<head>

    <title>Digi Wealth HR Panel</title>

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
    >

    <style>

        body {
            font-family: Arial, sans-serif;
            max-width: 700px;
            margin: 40px auto;
            padding: 20px;
            background: #f5f5f5;
        }

        .box {
            background: white;
            padding: 25px;
            border-radius: 12px;
        }

        input,
        textarea,
        select {

            width: 100%;
            padding: 12px;
            margin-top: 8px;
            margin-bottom: 18px;
            box-sizing: border-box;
            border: 1px solid #ccc;
            border-radius: 8px;

        }

        textarea {
            min-height: 120px;
        }

        button {

            padding: 12px 18px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            margin-right: 8px;
            margin-bottom: 10px;

        }

        .template {

            background: #25D366;
            color: white;

        }

        .text {

            background: #333;
            color: white;

        }

        .save {

            background: #2563eb;
            color: white;
            width: 100%;

        }

        .table-wrap {
            overflow-x: auto;
            margin-top: 15px;
            border: 1px solid #ddd;
            border-radius: 10px;
            background: #fff;
        }

        .candidate-table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1050px;
        }

        .candidate-table th,
        .candidate-table td {
            border-bottom: 1px solid #e5e5e5;
            padding: 10px;
            text-align: left;
            vertical-align: top;
        }

        .candidate-table th {
            background: #f3f4f6;
            font-size: 13px;
            white-space: nowrap;
        }

        .candidate-table td {
            font-size: 13px;
        }

        .candidate-table input,
        .candidate-table select,
        .candidate-table textarea {
            margin: 0;
            min-width: 150px;
        }

        .candidate-table textarea {
            min-height: 70px;
        }

        .candidate-table .phone-cell {
            font-weight: bold;
            white-space: nowrap;
        }

        .candidate-table .date-cell {
            color: #666;
            font-size: 12px;
            white-space: nowrap;
        }

        .candidate-table .save-cell {
            min-width: 130px;
        }

        .candidate-table .save {
            width: auto;
            margin: 0;
            white-space: nowrap;
        }

        .details {
            background: #111827;
            color: white;
            width: auto;
            margin: 0 0 8px 0;
            white-space: nowrap;
        }

        .details-modal {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.55);
            z-index: 9999;
            padding: 20px;
            box-sizing: border-box;
            overflow-y: auto;
        }

        .details-box {
            max-width: 650px;
            margin: 40px auto;
            background: white;
            border-radius: 14px;
            padding: 24px;
            box-sizing: border-box;
            box-shadow: 0 10px 40px rgba(0,0,0,0.25);
        }

        .details-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 15px;
            margin-bottom: 15px;
        }

        .details-header h3 {
            margin: 0;
        }

        .close-details {
            background: #e5e7eb;
            color: #111827;
            margin: 0;
        }

        .details-box label {
            display: block;
            font-weight: bold;
            margin-top: 12px;
        }

        .details-box input,
        .details-box select,
        .details-box textarea {
            width: 100%;
            box-sizing: border-box;
            margin-top: 6px;
            margin-bottom: 10px;
            padding: 11px;
        }

        .details-box textarea {
            min-height: 110px;
        }

        .details-actions {
            display: flex;
            gap: 8px;
            margin-top: 15px;
        }

        .details-save {
            background: #2563eb;
            color: white;
        }

        .message-history {
            margin-top: 10px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px;
            background: #f9fafb;
            max-height: 360px;
            overflow-y: auto;
        }

        .message-item {
            max-width: 82%;
            padding: 9px 11px;
            border-radius: 10px;
            margin-bottom: 10px;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 13px;
            line-height: 1.4;
        }

        .message-incoming {
            margin-right: auto;
            background: #e5e7eb;
            color: #111827;
        }

        .message-outgoing {
            margin-left: auto;
            background: #dcfce7;
            color: #166534;
        }

        .message-meta {
            margin-top: 5px;
            font-size: 11px;
            opacity: 0.7;
        }

        .message-empty,
        .message-loading,
        .message-error {
            color: #666;
            font-size: 13px;
            padding: 8px 0;
        }

        .reply-box {
            margin-top: 12px;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            background: #f9fafb;
        }

        .reply-box textarea {
            min-height: 90px;
            margin-bottom: 8px;
        }

        .reply-send {
            background: #25D366;
            color: white;
            margin: 0;
        }

        #result {

            margin-top: 20px;
            padding: 12px;
            border-radius: 8px;
            display: none;

        }

    </style>

</head>

<body>

<div class="box">

    <h2>📱 Digi Wealth HR Panel</h2>

    <p>
        Send WhatsApp message to a candidate.
    </p>

    <label>
        HR Panel Key
    </label>

    <input
        type="password"
        id="adminKey"
        placeholder="Enter HR panel key"
    >

    <label>
        Candidate WhatsApp Number
    </label>

    <input
        type="text"
        id="phone"
        placeholder="Example: 919876543210"
    >

    <label>
        Message
    </label>

    <textarea
        id="message"
        placeholder="Type your message here..."
    ></textarea>

    <button
        class="template"
        onclick="sendTemplate()"
    >
        📋 Send Approved Template
    </button>

    <button
        class="text"
        onclick="sendText()"
    >
        💬 Send Text Message
    </button>

    <div id="result"></div>

    <hr>

    <h3>
        👥 Candidates
    </h3>

    <button
        class="text"
        onclick="loadCandidates()"
    >
        🔄 Load Candidates
    </button>

    <label>
        🗂️ View by Category
    </label>

    <select id="categoryFilter" onchange="window.filterCandidatesByCategory()">
        <option value="All">All Candidates</option>
        <option value="New">New</option>
        <option value="Shortlisted">Shortlisted</option>
        <option value="Interview">Interview</option>
        <option value="Selected">Selected</option>
        <option value="Rejected">Rejected</option>
        <option value="On Hold">On Hold</option>
    </select>

    <div id="category-summary"></div>

    <div id="candidates"></div>

</div>

<div id="candidateModal" class="details-modal">
    <div class="details-box">

        <div class="details-header">
            <h3>👤 Candidate Details</h3>
            <button
                type="button"
                class="close-details"
                onclick="window.closeCandidateDetails()"
            >
                ✕ Close
            </button>
        </div>

        <label>WhatsApp Number</label>
        <input type="text" id="detail-phone" readonly>

        <label>Last Message</label>
        <input type="text" id="detail-last-message" readonly>

        <label>Candidate Name</label>
        <input type="text" id="detail-name" placeholder="Candidate name">

        <label>🗂️ Candidate Category</label>
        <select id="detail-category">
            <option value="New">New</option>
            <option value="Shortlisted">Shortlisted</option>
            <option value="Interview">Interview</option>
            <option value="Selected">Selected</option>
            <option value="Rejected">Rejected</option>
            <option value="On Hold">On Hold</option>
        </select>

        <label>Application Status</label>
        <select id="detail-status">
            <option value="New">New</option>
            <option value="Screening">Screening</option>
            <option value="Shortlisted">Shortlisted</option>
            <option value="Rejected">Rejected</option>
            <option value="Selected">Selected</option>
        </select>

        <label>Onboarding Status</label>
        <select id="detail-onboarding">
            <option value="Pending">Pending</option>
            <option value="Form Sent">Form Sent</option>
            <option value="Form Received">Form Received</option>
            <option value="Completed">Completed</option>
        </select>

        <label>Interview Status</label>
        <select id="detail-interview">
            <option value="Not Scheduled">Not Scheduled</option>
            <option value="Scheduled">Scheduled</option>
            <option value="Completed">Completed</option>
            <option value="Selected">Selected</option>
            <option value="Rejected">Rejected</option>
        </select>

        <label>HR Notes</label>
        <textarea id="detail-notes" placeholder="HR notes..."></textarea>

        <label>💬 WhatsApp Message History</label>
        <div id="message-history" class="message-history">
            <div class="message-loading">Loading messages...</div>
        </div>

        <div class="reply-box">
            <label>✍️ Reply to Candidate</label>
            <textarea
                id="candidate-reply"
                placeholder="Type your WhatsApp reply here..."
            ></textarea>
            <button
                type="button"
                class="reply-send"
                onclick="window.sendCandidateReply()"
            >
                📤 Send Reply
            </button>
        </div>

        <div class="details-actions">
            <button
                type="button"
                class="details-save"
                onclick="window.saveCandidateDetails()"
            >
                💾 Save Details
            </button>

            <button
                type="button"
                class="close-details"
                onclick="window.closeCandidateDetails()"
            >
                Cancel
            </button>
        </div>

    </div>
</div>

<script>

// ===============================
// ESCAPE HTML
// ===============================

function escapeHtml(value) {

    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ===============================
// SEND TEMPLATE
// ===============================

async function sendTemplate() {

    const key =
        document.getElementById(
            "adminKey"
        ).value;

    const phone =
        document.getElementById(
            "phone"
        ).value;

    if (!key || !phone) {

        showResult(
            "Please enter HR key and candidate number.",
            false
        );

        return;
    }

    showResult(
        "Sending template...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/send-template",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-admin-key":
                            key
                    },

                    body: JSON.stringify({
                        phone: phone
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to send"
            );
        }

        showResult(
            "✅ Template sent successfully!",
            true
        );

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );
    }
}


// ===============================
// SEND TEXT
// ===============================

async function sendText() {

    const key =
        document.getElementById(
            "adminKey"
        ).value;

    const phone =
        document.getElementById(
            "phone"
        ).value;

    const message =
        document.getElementById(
            "message"
        ).value;

    if (!key || !phone || !message) {

        showResult(
            "Please enter all required fields.",
            false
        );

        return;
    }

    showResult(
        "Sending message...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/send-text",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-admin-key":
                            key
                    },

                    body: JSON.stringify({
                        phone: phone,
                        message: message
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to send"
            );
        }

        showResult(
            "✅ Message sent successfully!",
            true
        );

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );
    }
}


// ===============================
// LOAD CANDIDATES
// ===============================

async function loadCandidates() {

    const key =
        document.getElementById(
            "adminKey"
        ).value;

    if (!key) {

        showResult(
            "Please enter HR panel key.",
            false
        );

        return;
    }

    showResult(
        "Loading candidates...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/candidates",
                {
                    method: "GET",

                    headers: {
                        "x-admin-key":
                            key
                    }
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to load candidates"
            );
        }

        const container =
            document.getElementById(
                "candidates"
            );

        if (data.length === 0) {

            container.innerHTML =
                "<p>No candidates found yet.</p>";

            showResult(
                "No candidates found yet.",
                true
            );

            return;
        }

        window.allCandidatesData = data;

        window.renderCandidatesTable(data);

        showResult(
            "✅ Candidates loaded successfully.",
            true
        );

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );
    }
}


// ===============================
// RENDER / FILTER CANDIDATES
// ===============================

window.renderCandidatesTable = function(data) {

    const container =
        document.getElementById("candidates");

    const summary =
        document.getElementById("category-summary");

    if (!data.length) {
        container.innerHTML =
            "<p>No candidates found in this category.</p>";
        if (summary) summary.innerHTML = "";
        return;
    }

    const counts = {};
    data.forEach(function(candidate) {
        const category = candidate.category || "New";
        counts[category] = (counts[category] || 0) + 1;
    });

    if (summary) {
        summary.innerHTML =
            "<p><strong>Showing " + data.length +
            " candidate(s)</strong></p>";
    }

    container.innerHTML =
            '<div class="table-wrap">' +
            '<table class="candidate-table">' +
            '<thead>' +
            '<tr>' +
            '<th>WhatsApp Number</th>' +
            '<th>Last Message</th>' +
            '<th>Candidate Name</th>' +
            '<th>Category</th>' +
            '<th>Application Status</th>' +
            '<th>Onboarding Status</th>' +
            '<th>Interview Status</th>' +
            '<th>HR Notes</th>' +
            '<th>Action</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>' +
            data.map(function(candidate) {

                const phone =
                    escapeHtml(candidate.phone);

                const name =
                    escapeHtml(candidate.name);

                const category =
                    escapeHtml(candidate.category || "New");

                const status =
                    escapeHtml(candidate.status || "New");

                const onboardingStatus =
                    escapeHtml(
                        candidate.onboardingStatus || "Pending"
                    );

                const interviewStatus =
                    escapeHtml(
                        candidate.interviewStatus || "Not Scheduled"
                    );

                const notes =
                    escapeHtml(candidate.notes);

                const lastMessage =
                    escapeHtml(candidate.lastMessage);

                return '<tr>' +
                    '<td class="phone-cell">📱 ' + phone + '</td>' +
                    '<td class="date-cell">' + lastMessage + '</td>' +
                    '<td>' +
                        '<input type="text" id="name-' + phone +
                        '" value="' + name +
                        '" placeholder="Candidate name">' +
                    '</td>' +
                    '<td>' +
                        '<select id="category-' + phone + '">' +
                            '<option value="New"' +
                                (category === "New" ? ' selected' : '') +
                            '>New</option>' +
                            '<option value="Shortlisted"' +
                                (category === "Shortlisted" ? ' selected' : '') +
                            '>Shortlisted</option>' +
                            '<option value="Interview"' +
                                (category === "Interview" ? ' selected' : '') +
                            '>Interview</option>' +
                            '<option value="Selected"' +
                                (category === "Selected" ? ' selected' : '') +
                            '>Selected</option>' +
                            '<option value="Rejected"' +
                                (category === "Rejected" ? ' selected' : '') +
                            '>Rejected</option>' +
                            '<option value="On Hold"' +
                                (category === "On Hold" ? ' selected' : '') +
                            '>On Hold</option>' +
                        '</select>' +
                    '</td>' +
                    '<td>' +
                        '<select id="status-' + phone + '">' +
                            '<option value="New"' +
                                (status === "New" ? ' selected' : '') +
                            '>New</option>' +
                            '<option value="Screening"' +
                                (status === "Screening" ? ' selected' : '') +
                            '>Screening</option>' +
                            '<option value="Shortlisted"' +
                                (status === "Shortlisted" ? ' selected' : '') +
                            '>Shortlisted</option>' +
                            '<option value="Rejected"' +
                                (status === "Rejected" ? ' selected' : '') +
                            '>Rejected</option>' +
                            '<option value="Selected"' +
                                (status === "Selected" ? ' selected' : '') +
                            '>Selected</option>' +
                        '</select>' +
                    '</td>' +
                    '<td>' +
                        '<select id="onboarding-' + phone + '">' +
                            '<option value="Pending"' +
                                (onboardingStatus === "Pending" ? ' selected' : '') +
                            '>Pending</option>' +
                            '<option value="Form Sent"' +
                                (onboardingStatus === "Form Sent" ? ' selected' : '') +
                            '>Form Sent</option>' +
                            '<option value="Form Received"' +
                                (onboardingStatus === "Form Received" ? ' selected' : '') +
                            '>Form Received</option>' +
                            '<option value="Completed"' +
                                (onboardingStatus === "Completed" ? ' selected' : '') +
                            '>Completed</option>' +
                        '</select>' +
                    '</td>' +
                    '<td>' +
                        '<select id="interview-' + phone + '">' +
                            '<option value="Not Scheduled"' +
                                (interviewStatus === "Not Scheduled" ? ' selected' : '') +
                            '>Not Scheduled</option>' +
                            '<option value="Scheduled"' +
                                (interviewStatus === "Scheduled" ? ' selected' : '') +
                            '>Scheduled</option>' +
                            '<option value="Completed"' +
                                (interviewStatus === "Completed" ? ' selected' : '') +
                            '>Completed</option>' +
                            '<option value="Selected"' +
                                (interviewStatus === "Selected" ? ' selected' : '') +
                            '>Selected</option>' +
                            '<option value="Rejected"' +
                                (interviewStatus === "Rejected" ? ' selected' : '') +
                            '>Rejected</option>' +
                        '</select>' +
                    '</td>' +
                    '<td>' +
                        '<textarea id="notes-' + phone +
                        '" placeholder="HR notes...">' +
                        notes +
                        '</textarea>' +
                    '</td>' +
                    '<td class="save-cell">' +
                        '<button type="button" class="details" ' +
                        'onclick="window.viewCandidateDetails(\\'' + phone + '\\')">' +
                        '👁 View' +
                        '</button>' +
                        '<button type="button" class="save" ' +
                        'onclick="window.saveCandidate(\\'' + phone + '\\')">' +
                        '💾 Save' +
                        '</button>' +
                    '</td>' +
                '</tr>';

            }).join("") +
            '</tbody>' +
            '</table>' +
            '</div>';
}


window.filterCandidatesByCategory = function() {

    const filter =
        document.getElementById("categoryFilter").value;

    const allCandidates =
        window.allCandidatesData || [];

    const filtered =
        filter === "All"
            ? allCandidates
            : allCandidates.filter(function(candidate) {
                return (candidate.category || "New") === filter;
            });

    window.renderCandidatesTable(filtered);
};


// ===============================
// SAVE CANDIDATE
// ===============================

window.saveCandidate = async function(phone) {

    const key =
        document.getElementById(
            "adminKey"
        ).value;

    const name =
        document.getElementById(
            "name-" + phone
        ).value;

    const category =
        document.getElementById(
            "category-" + phone
        ).value;

    const status =
        document.getElementById(
            "status-" + phone
        ).value;

    const onboardingStatus =
        document.getElementById(
            "onboarding-" + phone
        ).value;

    const interviewStatus =
        document.getElementById(
            "interview-" + phone
        ).value;

    const notes =
        document.getElementById(
            "notes-" + phone
        ).value;

    if (!key) {

        showResult(
            "Please enter HR panel key.",
            false
        );

        return;
    }

    showResult(
        "Saving candidate...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/candidates/" +
                encodeURIComponent(phone),
                {
                    method: "PUT",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-admin-key":
                            key
                    },

                    body: JSON.stringify({

                        name:
                            name,

                        category:
                            category,

                        status:
                            status,

                        onboardingStatus:
                            onboardingStatus,

                        interviewStatus:
                            interviewStatus,

                        notes:
                            notes
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Failed to save candidate"
            );
        }

        showResult(
            "✅ Candidate saved successfully!",
            true
        );

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );
    }
}


// ===============================
// CANDIDATE DETAILED VIEW
// ===============================

async function loadCandidateMessages(phone) {

    const container =
        document.getElementById("message-history");

    const key =
        document.getElementById("adminKey").value;

    if (!container) return;

    container.innerHTML =
        '<div class="message-loading">Loading messages...</div>';

    if (!key) {
        container.innerHTML =
            '<div class="message-error">HR panel key is required.</div>';
        return;
    }

    try {

        const response =
            await fetch(
                "/api/candidates/" +
                encodeURIComponent(phone) +
                "/messages",
                {
                    method: "GET",
                    headers: {
                        "x-admin-key": key
                    }
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to load message history"
            );
        }

        if (!data.length) {
            container.innerHTML =
                '<div class="message-empty">No WhatsApp messages recorded yet.</div>';
            return;
        }

        container.innerHTML =
            data.map(function(item) {

                const direction =
                    item.direction === "outgoing"
                        ? "outgoing"
                        : "incoming";

                const label =
                    direction === "outgoing"
                        ? "HR"
                        : "Candidate";

                const date =
                    item.createdAt
                        ? new Date(item.createdAt).toLocaleString()
                        : "";

                return (
                    '<div class="message-item message-' +
                    direction +
                    '">' +
                    '<div>' +
                    escapeHtml(item.message) +
                    '</div>' +
                    '<div class="message-meta">' +
                    escapeHtml(label) +
                    ' • ' +
                    escapeHtml(item.messageType || "text") +
                    ' • ' +
                    escapeHtml(date) +
                    '</div>' +
                    '</div>'
                );

            }).join("");

        container.scrollTop = container.scrollHeight;

    } catch (error) {

        container.innerHTML =
            '<div class="message-error">❌ ' +
            escapeHtml(error.message) +
            '</div>';
    }
}



window.viewCandidateDetails = function(phone) {

    const nameInput =
        document.getElementById("name-" + phone);

    if (!nameInput) {
        showResult(
            "❌ Candidate row not found.",
            false
        );
        return;
    }

    const statusSelect =
        document.getElementById("status-" + phone);

    const onboardingSelect =
        document.getElementById("onboarding-" + phone);

    const interviewSelect =
        document.getElementById("interview-" + phone);

    const notesInput =
        document.getElementById("notes-" + phone);

    const row =
        nameInput.closest("tr");

    const lastMessageCell =
        row.querySelector(".date-cell");

    document.getElementById("detail-phone").value =
        phone;

    document.getElementById("detail-last-message").value =
        lastMessageCell
            ? lastMessageCell.innerText
            : "";

    document.getElementById("detail-name").value =
        nameInput ? nameInput.value : "";

    const categorySelect =
        document.getElementById("category-" + phone);

    document.getElementById("detail-category").value =
        categorySelect ? categorySelect.value : "New";

    document.getElementById("detail-status").value =
        statusSelect ? statusSelect.value : "New";

    document.getElementById("detail-onboarding").value =
        onboardingSelect
            ? onboardingSelect.value
            : "Pending";

    document.getElementById("detail-interview").value =
        interviewSelect
            ? interviewSelect.value
            : "Not Scheduled";

    document.getElementById("detail-notes").value =
        notesInput ? notesInput.value : "";

    document.getElementById("candidateModal").style.display =
        "block";

    loadCandidateMessages(phone);
};


window.sendCandidateReply = async function() {

    const key =
        document.getElementById("adminKey").value;

    const phone =
        document.getElementById("detail-phone").value;

    const replyBox =
        document.getElementById("candidate-reply");

    const message =
        replyBox.value.trim();

    if (!key) {
        showResult(
            "Please enter HR panel key.",
            false
        );
        return;
    }

    if (!phone) {
        showResult(
            "Candidate WhatsApp number is missing.",
            false
        );
        return;
    }

    if (!message) {
        showResult(
            "Please type a reply message.",
            false
        );
        return;
    }

    replyBox.disabled = true;

    showResult(
        "Sending WhatsApp reply...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/send-text",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "x-admin-key":
                            key
                    },
                    body: JSON.stringify({
                        phone: phone,
                        message: message
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to send WhatsApp reply"
            );
        }

        replyBox.value = "";

        showResult(
            "✅ Reply sent successfully!",
            true
        );

        await loadCandidateMessages(phone);

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );

    } finally {

        replyBox.disabled = false;
    }
};


window.closeCandidateDetails = function() {

    document.getElementById("candidateModal").style.display =
        "none";
};


window.saveCandidateDetails = async function() {

    const key =
        document.getElementById("adminKey").value;

    const phone =
        document.getElementById("detail-phone").value;

    const name =
        document.getElementById("detail-name").value;

    const category =
        document.getElementById("detail-category").value;

    const status =
        document.getElementById("detail-status").value;

    const onboardingStatus =
        document.getElementById("detail-onboarding").value;

    const interviewStatus =
        document.getElementById("detail-interview").value;

    const notes =
        document.getElementById("detail-notes").value;

    if (!key) {
        showResult(
            "Please enter HR panel key.",
            false
        );
        return;
    }

    showResult(
        "Saving candidate details...",
        true
    );

    try {

        const response =
            await fetch(
                "/api/candidates/" +
                encodeURIComponent(phone),
                {
                    method: "PUT",
                    headers: {
                        "Content-Type":
                            "application/json",
                        "x-admin-key":
                            key
                    },
                    body: JSON.stringify({
                        name: name,
                        category: category,
                        status: status,
                        onboardingStatus:
                            onboardingStatus,
                        interviewStatus:
                            interviewStatus,
                        notes: notes
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Failed to save candidate"
            );
        }

        const nameInput =
            document.getElementById("name-" + phone);

        const categorySelect =
            document.getElementById("category-" + phone);

        const statusSelect =
            document.getElementById("status-" + phone);

        const onboardingSelect =
            document.getElementById("onboarding-" + phone);

        const interviewSelect =
            document.getElementById("interview-" + phone);

        const notesInput =
            document.getElementById("notes-" + phone);

        if (nameInput) nameInput.value = name;
        if (categorySelect) categorySelect.value = category;
        if (statusSelect) statusSelect.value = status;
        if (onboardingSelect)
            onboardingSelect.value = onboardingStatus;
        if (interviewSelect)
            interviewSelect.value = interviewStatus;
        if (notesInput) notesInput.value = notes;

        window.closeCandidateDetails();

        showResult(
            "✅ Candidate saved successfully!",
            true
        );

    } catch (error) {

        showResult(
            "❌ " + error.message,
            false
        );
    }
};


// ===============================
// RESULT MESSAGE
// ===============================

function showResult(
    message,
    success
) {

    const result =
        document.getElementById(
            "result"
        );

    result.style.display =
        "block";

    result.innerText =
        message;
}

</script>

</body>

</html>
    `);

});

// ===============================
// SEND TEMPLATE FROM HR PANEL
// ===============================

app.post(
    "/api/send-template",
    checkAdmin,
    async (req, res) => {

        try {

            const phone =
                String(
                    req.body.phone || ""
                ).replace(/\D/g, "");

            if (!phone) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Candidate WhatsApp number is required."
                    });
            }

            const result =
                await sendWhatsAppTemplate(
                    phone
                );

            console.log(
                "Template sent to:",
                phone
            );

            res.json({
                success: true,
                result: result
            });

        } catch (error) {

            console.error(
                "Template send failed:",
                error.message
            );

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

// ===============================
// SEND TEXT FROM HR PANEL
// ===============================

app.post(
    "/api/send-text",
    checkAdmin,
    async (req, res) => {

        try {

            const phone =
                String(
                    req.body.phone || ""
                ).replace(/\D/g, "");

            const message =
                String(
                    req.body.message || ""
                ).trim();

            if (!phone) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Candidate WhatsApp number is required."
                    });
            }

            if (!message) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Message is required."
                    });
            }

            const result =
                await sendWhatsAppMessage(
                    phone,
                    message
                );

            console.log(
                "Text message sent to:",
                phone
            );

            res.json({
                success: true,
                result: result
            });

        } catch (error) {

            console.error(
                "Text send failed:",
                error.message
            );

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

// ===============================
// START SERVER
// ===============================

const PORT =
    process.env.PORT || 10000;

initializeDatabase()
    .then(() => {

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `Server running on port ${PORT}`
                );

            }
        );

    })
    .catch((error) => {

        console.error(
            "Database initialization failed:",
            error
        );

        process.exit(1);
    });
