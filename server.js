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
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

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

    console.log("WhatsApp reply sent:");
    console.log(JSON.stringify(data, null, 2));
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
                            console.log("Message:", message.text.body);

                            sendWhatsAppMessage(
                                message.from,
                                "Hello! 👋 Thanks for messaging Digi Wealth. We received your message."
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
