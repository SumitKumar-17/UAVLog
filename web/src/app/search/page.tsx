import { Suspense } from "react";
import { SearchView } from "@/components/search-view";

export const metadata = { title: "Search · UAV Log" };

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="pt-10 text-ink-2" aria-busy>Loading search</div>}>
      <SearchView />
    </Suspense>
  );
}
