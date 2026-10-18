import { Suspense } from "react";
import { CompareView } from "@/components/compare-view";

export const metadata = { title: "Compare · UAV Log" };

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="pt-10 text-ink-2" aria-busy>Loading</div>}>
      <CompareView />
    </Suspense>
  );
}
