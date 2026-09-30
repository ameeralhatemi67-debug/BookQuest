import type { Metadata } from "next";
import { SearchView } from "@/components/app/search-view";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <SearchView initialQuery={typeof params.q === "string" ? params.q.slice(0, 100) : ""} />;
}
