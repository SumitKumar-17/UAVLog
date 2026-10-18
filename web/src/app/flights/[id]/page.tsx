import { Suspense } from "react";
import { FlightView } from "@/components/flight-view";

async function Flight({ params }: { params: PageProps<"/flights/[id]">["params"] }) {
  const { id } = await params;
  return <FlightView id={id} />;
}

export default function FlightPage(props: PageProps<"/flights/[id]">) {
  return (
    <Suspense fallback={<div className="pt-10 text-ink-2" aria-busy>Loading flight</div>}>
      <Flight params={props.params} />
    </Suspense>
  );
}
