import { Playground } from "./playground";

export default async function Page({ searchParams }: { searchParams: Promise<{ mock?: string }> }) {
  const { mock } = await searchParams;
  return <Playground mock={mock === "1"} />;
}
