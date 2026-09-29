const express = require("express");

const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const ADMIN_PANEL_KEY = process.env.ADMIN_PANEL_KEY;
const GRAPH_API_VERSION = "v25.0";

// ===============================
// CANDIDATE DATA
// ===============================

const candidates = {};

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
    console.log(JSON.stringify(req.body, null, 2));

    if (req.body.object === "whatsapp_business_account") {
        const entries = req.body.entry || [];

        entries.forEach((entry) => {
            const changes = entry.changes || [];

            changes.forEach((change) => {
                const value = change.value;

                if (value.messages) {
                    value.messages.forEach((message) => {

                        console.log("---------------");
                        console.log("MESSAGE RECEIVED");
                        console.log("From:", message.from);
                        console.log("Type:", message.type);

                        // Save candidate information
                        candidates[message.from] = {
                            phone: message.from,
                            lastMessage: new Date().toISOString()
                        };

                        if (message.type === "text") {
                            const incomingText = message.text.body;

                            console.log("Message:", incomingText);

                            const reply = getReply(incomingText);

                            sendWhatsAppMessage(message.from, reply)
                                .catch((error) => {
                                    console.error(
                                        "Failed to send WhatsApp reply:",
                                        error.message
                                    );
                                });
                        }

                        console.log("---------------");
                    });
                }

                if (value.statuses) {
                    value.statuses.forEach((status) => {
                        console.log("STATUS UPDATE");
                        console.log("ID:", status.id);
                        console.log("Status:", status.status);
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
    const key = req.headers["x-admin-key"];

    if (!ADMIN_PANEL_KEY) {
        return res.status(500).send("ADMIN_PANEL_KEY is not configured.");
    }

    if (key !== ADMIN_PANEL_KEY) {
        return res.status(401).send("Unauthorized");
    }

    next();
}

// ===============================
// CANDIDATE LIST API
// ===============================

app.get("/api/candidates", checkAdmin, (req, res) => {
    res.json(Object.values(candidates));
});

// ===============================
// HR PANEL
// ===============================

app.get("/hr", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Digi Wealth HR Panel</title>

    <meta name="viewport" content="width=device-width, initial-scale=1">

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

        input, textarea {
            width: 100%;
            padding: 12px;
            margin-top: 8px;
            margin-bottom: 18px;
            box-sizing: border-box;
            border: 1px solid #ccc;
            border-radius: 8px;
        }

        textarea {
            min-height: 150px;
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

    <p>Send WhatsApp message to a candidate.</p>

    <label>HR Panel Key</label>
    <input
        type="password"
        id="adminKey"
        placeholder="Enter HR panel key"
    >

    <label>Candidate WhatsApp Number</label>
    <input
        type="text"
        id="phone"
        placeholder="Example: 919876543210"
    >

    <label>Message</label>
    <textarea
        id="message"
        placeholder="Type your message here..."
    ></textarea>

    <button class="template" onclick="sendTemplate()">
        📋 Send Approved Template
    </button>

    <button class="text" onclick="sendText()">
        💬 Send Text Message
    </button>

    <div id="result"></div>

    <hr>

    <h3>👥 Candidates</h3>

    <button class="text" onclick="loadCandidates()">
        🔄 Load Candidates
    </button>

    <div id="candidates"></div>

</div>

<script>

async function sendTemplate() {

    const key = document.getElementById("adminKey").value;
    const phone = document.getElementById("phone").value;

    if (!key || !phone) {
        showResult("Please enter HR key and candidate number.", false);
        return;
    }

    showResult("Sending template...", true);

    try {

        const response = await fetch("/api/send-template", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-admin-key": key
            },

            body: JSON.stringify({
                phone: phone
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to send");
        }

        showResult("✅ Template sent successfully!", true);

    } catch (error) {

        showResult("❌ " + error.message, false);

    }
}


async function sendText() {

    const key = document.getElementById("adminKey").value;
    const phone = document.getElementById("phone").value;
    const message = document.getElementById("message").value;

    if (!key || !phone || !message) {
        showResult("Please enter all required fields.", false);
        return;
    }

    showResult("Sending message...", true);

    try {

        const response = await fetch("/api/send-text", {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-admin-key": key
            },

            body: JSON.stringify({
                phone: phone,
                message: message
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to send");
        }

        showResult("✅ Message sent successfully!", true);

    } catch (error) {

        showResult("❌ " + error.message, false);

    }
}


async function loadCandidates() {

    const key = document.getElementById("adminKey").value;

    if (!key) {
        showResult("Please enter HR panel key.", false);
        return;
    }

    showResult("Loading candidates...", true);

    try {

        const response = await fetch("/api/candidates", {
            method: "GET",

            headers: {
                "x-admin-key": key
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to load candidates");
        }

        const container = document.getElementById("candidates");

        if (data.length === 0) {
            container.innerHTML = "<p>No candidates found yet.</p>";
            return;
        }

        container.innerHTML = data.map(function(candidate) {

            return (
                '<div style="border:1px solid #ddd;' +
                'padding:12px;margin-top:10px;' +
                'border-radius:8px;background:#fafafa;">' +
                '<strong>📱 ' + candidate.phone + '</strong><br>' +
                '<small>Last message: ' + candidate.lastMessage + '</small>' +
                '</div>'
            );

        }).join("");

        showResult("✅ Candidates loaded successfully.", true);

    } catch (error) {

        showResult("❌ " + error.message, false);

    }
}


function showResult(message, success) {

    const result = document.getElementById("result");

    result.style.display = "block";
    result.innerText = message;

}

</script>

</body>
</html>
    `);
});

// ===============================
// SEND TEMPLATE FROM HR PANEL
// ===============================

app.post("/api/send-template", checkAdmin, async (req, res) => {

    try {

        const phone = String(req.body.phone || "")
            .replace(/\D/g, "");

        if (!phone) {
            return res.status(400).json({
                error: "Candidate WhatsApp number is required."
            });
        }

        const result = await sendWhatsAppTemplate(phone);

        console.log("Template sent to:", phone);

        res.json({
            success: true,
            result: result
        });

    } catch (error) {

        console.error("Template send failed:", error.message);

        res.status(500).json({
            error: error.message
        });
    }
});

// ===============================
// SEND TEXT FROM HR PANEL
// ===============================

app.post("/api/send-text", checkAdmin, async (req, res) => {

    try {

        const phone = String(req.body.phone || "")
            .replace(/\D/g, "");

        const message = String(req.body.message || "").trim();

        if (!phone) {
            return res.status(400).json({
                error: "Candidate WhatsApp number is required."
            });
        }

        if (!message) {
            return res.status(400).json({
                error: "Message is required."
            });
        }

        const result = await sendWhatsAppMessage(phone, message);

        console.log("Text message sent to:", phone);

        res.json({
            success: true,
            result: result
        });

    } catch (error) {

        console.error("Text send failed:", error.message);

        res.status(500).json({
            error: error.message
        });
    }
});

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
