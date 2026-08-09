import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;

    const correctPassword = process.env.UPLOAD_PASSWORD;

    if (!correctPassword) {
      return NextResponse.json(
        { error: "Server configuration error: UPLOAD_PASSWORD is not set." },
        { status: 500 }
      );
    }

    if (password === correctPassword) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
