import { windChimeLive } from "@/lib/windchime-live";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => windChimeLive.GET(req);
export const POST = (req: Request) => windChimeLive.POST(req);
export const PUT = (req: Request) => windChimeLive.PUT(req);
export const PATCH = (req: Request) => windChimeLive.PATCH(req);
export const DELETE = (req: Request) => windChimeLive.DELETE(req);
export const OPTIONS = (req: Request) => windChimeLive.OPTIONS(req);
