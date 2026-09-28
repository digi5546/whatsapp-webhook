const express = require("express");

const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

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

                // Incoming messages
                if (value.messages) {

                    value.messages.forEach((message) => {

                        console.log("---------------");
                        console.log("MESSAGE RECEIVED");

                        console.log("From:", message.from);
                        console.log("Message ID:", message.id);
                        console.log("Type:", message.type);

                        if (message.type === "text") {
                            console.log(
                                "Message:",
                                message.text.body
                            );
                        }

                        console.log("---------------");
                    });
                }

                // Message status
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
