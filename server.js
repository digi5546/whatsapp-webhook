const express = require("express");

const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_API_VERSION = "v25.0";

// Home page
app.get("/", (req, res) => {
    res.send("WhatsApp Webhook is running!");
});

// Meta webhook verification
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("Webhook verification request received");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Webhook verified successfully!");
        return res.status(200).send(challenge);
    }

    console.log("Webhook verification failed");
    return res.sendStatus(403);
});

// Send WhatsApp message
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

    console.log("WhatsApp reply sent successfully");
}

// Create recruitment reply
function getReply(messageText) {
    const text = messageText.trim().toLowerCase();

    // Main menu
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

    // Onboarding Form
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

    // Talk to HR
    if (text === "2") {
        return `👨‍💼 Talk to HR

Thank you for contacting Digi Wealth HR.

Please type your question or message here, and our HR team will assist you regarding the Sales Trainee position.

Thank you.
HR Team
Digi Wealth`;
    }

    // Default reply
    return `👋 Welcome to Digi Wealth!

Thank you for your interest in the Sales Trainee position.

Please choose an option:

1️⃣ Complete Onboarding Form
2️⃣ Talk to HR

Reply with 1 or 2.`;
}

// Receive WhatsApp messages
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
                        console.log("Message ID:", message.id);
                        console.log("Type:", message.type);

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

// Render provides the PORT
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
