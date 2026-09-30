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

            await pool.query(
                `
                UPDATE candidates
                SET
                    name = $1,
                    status = $2,
                    onboarding_status = $3,
                    interview_status = $4,
                    notes = $5
                WHERE phone = $6
                `,
                [
                    name,
                    status,
                    onboardingStatus,
                    interviewStatus,
                    notes,
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

        .candidate {

            border: 1px solid #ddd;
            padding: 15px;
            margin-top: 15px;
            border-radius: 10px;
            background: #fafafa;

        }

        .candidate-title {

            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;

        }

        .last-message {

            font-size: 12px;
            color: #666;
            margin-bottom: 15px;

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

    <div id="candidates"></div>

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

        container.innerHTML =
            data.map(function(candidate) {

                const phone =
                    escapeHtml(
                        candidate.phone
                    );

                const name =
                    escapeHtml(
                        candidate.name
                    );

                const status =
                    escapeHtml(
                        candidate.status ||
                        "New"
                    );

                const onboardingStatus =
                    escapeHtml(
                        candidate.onboardingStatus ||
                        "Pending"
                    );

                const interviewStatus =
                    escapeHtml(
                        candidate.interviewStatus ||
                        "Not Scheduled"
                    );

                const notes =
                    escapeHtml(
                        candidate.notes
                    );

                const lastMessage =
                    escapeHtml(
                        candidate.lastMessage
                    );

                return \`

                    <div class="candidate">

                        <div class="candidate-title">
                            📱 \${phone}
                        </div>

                        <div class="last-message">
                            Last message: \${lastMessage}
                        </div>

                        <label>
                            Candidate Name
                        </label>

                        <input
                            type="text"
                            id="name-\${phone}"
                            value="\${name}"
                            placeholder="Enter candidate name"
                        >

                        <label>
                            Application Status
                        </label>

                        <select id="status-\${phone}">

                            <option value="New"
                                \${status === "New" ? "selected" : ""}>
                                New
                            </option>

                            <option value="Screening"
                                \${status === "Screening" ? "selected" : ""}>
                                Screening
                            </option>

                            <option value="Shortlisted"
                                \${status === "Shortlisted" ? "selected" : ""}>
                                Shortlisted
                            </option>

                            <option value="Rejected"
                                \${status === "Rejected" ? "selected" : ""}>
                                Rejected
                            </option>

                            <option value="Selected"
                                \${status === "Selected" ? "selected" : ""}>
                                Selected
                            </option>

                        </select>

                        <label>
                            Onboarding Status
                        </label>

                        <select id="onboarding-\${phone}">

                            <option value="Pending"
                                \${onboardingStatus === "Pending" ? "selected" : ""}>
                                Pending
                            </option>

                            <option value="Form Sent"
                                \${onboardingStatus === "Form Sent" ? "selected" : ""}>
                                Form Sent
                            </option>

                            <option value="Form Received"
                                \${onboardingStatus === "Form Received" ? "selected" : ""}>
                                Form Received
                            </option>

                            <option value="Completed"
                                \${onboardingStatus === "Completed" ? "selected" : ""}>
                                Completed
                            </option>

                        </select>

                        <label>
                            Interview Status
                        </label>

                        <select id="interview-\${phone}">

                            <option value="Not Scheduled"
                                \${interviewStatus === "Not Scheduled" ? "selected" : ""}>
                                Not Scheduled
                            </option>

                            <option value="Scheduled"
                                \${interviewStatus === "Scheduled" ? "selected" : ""}>
                                Scheduled
                            </option>

                            <option value="Completed"
                                \${interviewStatus === "Completed" ? "selected" : ""}>
                                Completed
                            </option>

                            <option value="Selected"
                                \${interviewStatus === "Selected" ? "selected" : ""}>
                                Selected
                            </option>

                            <option value="Rejected"
                                \${interviewStatus === "Rejected" ? "selected" : ""}>
                                Rejected
                            </option>

                        </select>

                        <label>
                            HR Notes
                        </label>

                        <textarea
                            id="notes-\${phone}"
                            placeholder="Enter HR notes..."
                        >\${notes}</textarea>

                        <button
                            class="save"
                            onclick="saveCandidate('\${phone}')"
                        >
                            💾 Save Candidate
                        </button>

                    </div>

                \`;

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
// SAVE CANDIDATE
// ===============================

async function saveCandidate(phone) {

    const key =
        document.getElementById(
            "adminKey"
        ).value;

    const name =
        document.getElementById(
            "name-" + phone
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
