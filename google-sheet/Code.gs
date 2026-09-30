const RENDER_WEBHOOK_URL = "https://digiwealth-whatsapp-webhook.onrender.com/api/sheet-send-template";
const SHEET_API_KEY = "PASTE_SHEET_API_KEY_HERE";

function sendPendingWhatsAppTemplates() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return;

  const headers = values[0].map(String);
  const phoneCol = headers.indexOf("WhatsApp Number");
  const nameCol = headers.indexOf("Name");
  const sendCol = headers.indexOf("Send");
  const statusCol = headers.indexOf("Status");
  const sentAtCol = headers.indexOf("Sent At");

  if (phoneCol === -1 || sendCol === -1 || statusCol === -1 || sentAtCol === -1) {
    throw new Error("Required columns: WhatsApp Number, Send, Status, Sent At");
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const send = String(row[sendCol] || "").trim().toLowerCase();
    const status = String(row[statusCol] || "").trim().toLowerCase();

    if (send !== "yes" || status === "sent") continue;

    const phone = String(row[phoneCol] || "").replace(/\D/g, "");
    const name = nameCol === -1 ? "" : String(row[nameCol] || "").trim();

    if (!phone) {
      sheet.getRange(i + 1, statusCol + 1).setValue("Failed: invalid number");
      continue;
    }

    try {
      const response = UrlFetchApp.fetch(RENDER_WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        headers: {
          "x-sheet-key": SHEET_API_KEY
        },
        payload: JSON.stringify({
          phone: phone,
          name: name
        }),
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code >= 200 && code < 300) {
        sheet.getRange(i + 1, statusCol + 1).setValue("Sent");
        sheet.getRange(i + 1, sentAtCol + 1).setValue(new Date());
      } else {
        sheet.getRange(i + 1, statusCol + 1).setValue("Failed: " + body.substring(0, 120));
      }

    } catch (error) {
      sheet.getRange(i + 1, statusCol + 1).setValue("Failed: " + error.message.substring(0, 120));
    }
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Digi Wealth WhatsApp")
    .addItem("Send Pending Templates", "sendPendingWhatsAppTemplates")
    .addToUi();
}
