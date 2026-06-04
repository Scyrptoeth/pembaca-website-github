import { NextResponse } from "next/server";
import { startLocalPreviewFromZip, stopActivePreview } from "@/lib/local-preview-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (process.env.VERCEL) {
      return NextResponse.json(
        { error: "Local preview runner is only available in the local developer workbench." },
        { status: 501 },
      );
    }

    const formData = await request.formData();
    const zipFile = formData.get("repositoryZip");

    if (!(zipFile instanceof File)) {
      return NextResponse.json({ error: "repositoryZip file is required." }, { status: 400 });
    }

    const result = await startLocalPreviewFromZip(zipFile);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: messageFromError(error) }, { status: 500 });
  }
}

export async function DELETE() {
  await stopActivePreview();
  return NextResponse.json({ ok: true });
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
