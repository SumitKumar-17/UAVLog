import { Suspense } from "react";
import { AskView } from "@/components/ask-view";

export const metadata = { title: "Ask · UAV Log" };

export default function AskPage() {
  return <Suspense fallback={null}><AskView /></Suspense>;
}
