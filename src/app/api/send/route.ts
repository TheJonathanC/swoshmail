import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { uploadToR2, getFileFromR2 } from "@/lib/r2";
import nodemailer from "nodemailer";

const ONE_GB = 1024 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // 2. Rate Limiting (Max 5 emails per minute per user)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("email_logs")
      .select("*", { count: "exact", head: true })
      .eq("sender_id", userId)
      .gt("sent_at", oneMinuteAgo);

    if (countError) {
      console.error("Rate limit check failed:", countError);
    } else if (count && count >= 5) {
      return NextResponse.json(
        { error: "Rate limit exceeded. You can only send 5 emails per minute." },
        { status: 429 }
      );
    }

    // 3. Parse input form data
    const formData = await request.formData();
    const customTo = formData.get("to") as string | null;
    const subject = formData.get("subject") as string | null;
    const bodyText = formData.get("body") as string | null;
    const saveToDrive = formData.get("saveToDrive") === "true";
    
    // Direct files uploaded on the spot
    const directFiles = formData.getAll("files") as File[];
    // IDs of files already in Swosh Drive to attach
    const driveFileIds = formData.getAll("driveFileIds") as string[];

    const smtpUser = process.env.EMAIL_USER;
    const smtpPass = process.env.EMAIL_PASS;
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "465");
    const defaultTo = process.env.EMAIL_TO || smtpUser;
    const emailTo = customTo || defaultTo;

    if (!smtpUser || !smtpPass || !emailTo) {
      return NextResponse.json(
        { error: "Server configuration error: Email settings are incomplete." },
        { status: 500 }
      );
    }

    const attachments: any[] = [];
    const loggedAttachments: { file_id: string | null; name: string; size: number }[] = [];

    // 4. Handle Save to Drive Quota check if requested
    if (saveToDrive && directFiles.length > 0) {
      const { data: existingFiles } = await supabase
        .from("files")
        .select("size")
        .eq("owner_id", userId);

      const currentTotal = (existingFiles || []).reduce((acc, f) => acc + parseInt(f.size), 0);
      const newTotalSize = directFiles.reduce((acc, f) => acc + f.size, 0);

      if (currentTotal + newTotalSize > ONE_GB) {
        return NextResponse.json(
          { error: `Storage quota exceeded. Cannot save copies to Swosh Drive (1 GB limit).` },
          { status: 400 }
        );
      }
    }

    // 5. Process Direct Upload Attachments
    for (const file of directFiles) {
      if (!file || file.size === 0) continue;
      
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      let linkedFileId: string | null = null;

      // Save copy to Swosh Drive if option is checked
      if (saveToDrive) {
        const fileKey = `drives/${userId}/${Date.now()}-${file.name}`;
        await uploadToR2(fileKey, buffer, file.type || "application/octet-stream");
        
        const downloadUrl = `/api/drive/download?key=${encodeURIComponent(fileKey)}`;
        const { data: dbFile, error: insertError } = await supabase
          .from("files")
          .insert({
            name: file.name,
            size: file.size,
            key: fileKey,
            url: downloadUrl,
            owner_id: userId,
          })
          .select()
          .single();

        if (!insertError && dbFile) {
          linkedFileId = dbFile.id;
        }
      }

      attachments.push({
        filename: file.name,
        content: buffer,
      });

      loggedAttachments.push({
        file_id: linkedFileId,
        name: file.name,
        size: file.size,
      });
    }

    // 6. Process Existing Swosh Drive Attachments
    for (const fileId of driveFileIds) {
      if (!fileId) continue;

      // Verify file exists and is owned by the user
      const { data: file, error: fetchError } = await supabase
        .from("files")
        .select("*")
        .eq("id", fileId)
        .eq("owner_id", userId)
        .single();

      if (fetchError || !file) {
        return NextResponse.json(
          { error: `Attachment error: File not found or access denied in Swosh Drive.` },
          { status: 404 }
        );
      }

      // Fetch the file stream from Cloudflare R2
      const r2Response = await getFileFromR2(file.key);
      const fileBytes = await r2Response.Body?.transformToByteArray();
      if (!fileBytes) {
        return NextResponse.json(
          { error: `Attachment error: Failed to retrieve file '${file.name}' from storage.` },
          { status: 500 }
        );
      }

      attachments.push({
        filename: file.name,
        content: Buffer.from(fileBytes),
      });

      loggedAttachments.push({
        file_id: file.id,
        name: file.name,
        size: file.size,
      });
    }

    // 7. Setup SMTP & Send Email
    const finalSubject = subject || (attachments.length > 0 ? `Swoshmail: ${attachments.length} attachments` : "Swoshmail Message");
    const fileNamesText = loggedAttachments.map(a => a.name).join(", ");
    const finalBody = bodyText || (attachments.length > 0 ? `Sent attachments: ${fileNamesText}` : "Empty message body.");

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"Swoshmail" <${smtpUser}>`,
      to: emailTo,
      subject: finalSubject,
      text: finalBody,
      attachments,
    });

    // 8. Log Email Transaction to Database
    const { data: mailLog, error: logError } = await supabase
      .from("email_logs")
      .insert({
        sender_id: userId,
        recipient: emailTo,
        subject: finalSubject,
        body: finalBody,
      })
      .select()
      .single();

    if (!logError && mailLog) {
      // Create email attachment log entries
      for (const attachment of loggedAttachments) {
        await supabase.from("email_attachments").insert({
          email_log_id: mailLog.id,
          file_id: attachment.file_id,
          file_name: attachment.name,
          file_size: attachment.size,
        });
      }
    }

    return NextResponse.json({ success: true, message: "Email sent successfully!" });
  } catch (error: any) {
    console.error("POST send mail error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to dispatch email." },
      { status: 500 }
    );
  }
}
