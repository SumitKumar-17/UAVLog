import { SearchBox } from "@/components/search-box";
import { FlightBoard } from "@/components/flight-board";
import { Corpus } from "@/components/corpus";

export default function Home() {
  return (
    <div className="pt-12">
      <section className="max-w-3xl">
        <h1 className="mb-4 font-dense text-4xl font-semibold tracking-tight">Ask about any flight</h1>
        <SearchBox />
      </section>

      <div className="mt-14 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-labelledby="board">
          <h2 id="board" className="font-dense text-2xl font-semibold">Flights with the most critical events</h2>
          <p className="mb-4 mt-1 max-w-2xl text-ink-2">Each strip is one flight. Colour shows the flight mode over time; marks show warnings and failures the autopilot or our rules flagged.</p>
          <FlightBoard />
        </section>
        <aside aria-labelledby="corpus" className="lg:border-l lg:border-rule lg:pl-8">
          <h2 id="corpus" className="mb-3 font-dense text-2xl font-semibold">The corpus</h2>
          <Corpus />
          <p className="mt-4 text-sm text-muted">Telemetry is stored in compressed columnar chunks; the Database page shows how much space that saves and how queries are planned.</p>
        </aside>
      </div>
    </div>
  );
}
