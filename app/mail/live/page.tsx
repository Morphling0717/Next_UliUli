import { redirect } from "next/navigation";

export default async function LegacyMailLivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const query = new URLSearchParams();
  for (const name of ["topicId", "userCode", "deviceCode"] as const) {
    const value = input[name];
    if (typeof value === "string" && value.length <= 256) query.set(name, value);
  }
  redirect(`/mail${query.size ? `?${query}` : ""}`);
}
