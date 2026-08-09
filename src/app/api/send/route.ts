import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const password = formData.get("password") as string;
    const files = formData.getAll("files") as File[];
    const customTo = formData.get("to") as string | null;
    const subject = formData.get("subject") as string | null;
    const bodyText = formData.get("body") as string | null;

    const correctPassword = process.env.UPLOAD_PASSWORD;
    if (!correctPassword) {
      return NextResponse.json(
        { error: "Server configuration error: UPLOAD_PASSWORD is not set." },
        { status: 500 }
      );
    }

    if (password !== correctPassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    // Verify Nodemailer environment variables are present
    const smtpUser = process.env.EMAIL_USER;
    const smtpPass = process.env.EMAIL_PASS;
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "465");
    const emailTo = customTo || process.env.EMAIL_TO || smtpUser; // Custom recipient, default fallback to configured EMAIL_TO or EMAIL_USER

    if (!smtpUser || !smtpPass) {
      return NextResponse.json(
        { error: "Server configuration error: Email credentials (EMAIL_USER/EMAIL_PASS) are not set." },
        { status: 500 }
      );
    }

    // Convert all files to buffers for attachments
    const attachments = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      attachments.push({
        filename: file.name,
        content: buffer,
      });
    }

    const fileNames = files.map(f => f.name).join(", ");
    const defaultSubject = files.length === 1 ? `Email Backup: ${files[0].name}` : `Email Backup: ${files.length} files`;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // SSL for port 465, TLS for other ports like 587
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailOptions = {
      from: `"Email Backup Service" <${smtpUser}>`,
      to: emailTo,
      subject: subject || defaultSubject,
      text: bodyText || `Attached are your backup files: ${fileNames}\nUploaded at: ${new Date().toLocaleString()}`,
      attachments,
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true, message: "File successfully emailed!" });
  } catch (error: any) {
    console.error("Error in email upload route:", error);
    return NextResponse.json(
      { error: error.message || "An unexpected error occurred while sending the email." },
      { status: 500 }
    );
  }
}
