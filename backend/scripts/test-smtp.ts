
import "dotenv/config";
import { transporter } from "../src/config/mailer";

async function testSMTP() {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.SMTP_USER,
      subject: "ReachInbox SMTP Test",
      text: "Congratulations! Your ReachInbox SMTP configuration is working.",
      html: `
        <h2>ReachInbox SMTP Test</h2>
        <p>Your Ethereal SMTP configuration is working successfully!</p>
      `,
    });

    console.log("✅ Test email sent successfully");
    console.log("Message ID:", info.messageId);
    console.log("Preview URL:", info.messageId
      ? nodemailerPreview(info)
      : "Not available");
  } catch (error) {
    console.error("❌ SMTP test failed:", error);
  } finally {
    await transporter.close();
  }
}

function nodemailerPreview(info: { messageId: string }) {
  return `https://ethereal.email/message/${info.messageId}`;
}

void testSMTP();
